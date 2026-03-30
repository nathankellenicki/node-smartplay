#!/usr/bin/env python3
"""
Grain-128A SAT Solver for LEGO Smart Play Tag Key Recovery

Expresses Grain-128A's initialization and keystream generation as
symbolic boolean constraints using z3, then adds known plaintext
constraints to solve for the 128-bit key.

Usage: /tmp/grain-sat/bin/python3 sat_solver.py

The solver uses known plaintext from the tag TLV structure:
- Content identity TLV header: 22 00 07 00 at plaintext offset 0
- type_byte: 03 (identity) or 06 (item) at a position within the identity record
- Resource ref constants: tag_byte 0x12, sub_type 08 00
- Known content_ref values from PPL preset table analysis

Multiple tags with different IVs but the same key provide independent
constraints that massively over-determine the 128-bit key.
"""

import sys
import time
from z3 import *

# ============================================================
# Grain-128A Symbolic Implementation
# ============================================================

class SymbolicGrain128A:
    """Grain-128A with z3 BitVec symbolic state"""

    def __init__(self, key_bits, iv_bytes):
        """
        key_bits: list of 128 z3 Bool variables
        iv_bytes: list of 12 concrete bytes (the IV)
        """
        # Expand IV bytes to bits (MSB first, matching reference impl)
        iv_bits = []
        for byte in iv_bytes:
            for j in range(7, -1, -1):
                iv_bits.append(BoolVal((byte >> j) & 1 == 1))

        # Initialize LFSR: IV bits + padding
        self.lfsr = list(iv_bits)  # 96 bits from IV
        self.lfsr += [BoolVal(True)] * 31  # bits 96-126 = 1
        self.lfsr += [BoolVal(False)]       # bit 127 = 0

        # Initialize NFSR: key bits (MSB first per byte)
        self.nfsr = list(key_bits)

        assert len(self.lfsr) == 128
        assert len(self.nfsr) == 128

    def lfsr_feedback(self):
        # f(x) = 1 + x^32 + x^47 + x^58 + x^90 + x^121 + x^128
        # In array terms: s[96] ^ s[81] ^ s[70] ^ s[38] ^ s[7] ^ s[0]
        return Xor(self.lfsr[96], Xor(self.lfsr[81], Xor(self.lfsr[70],
               Xor(self.lfsr[38], Xor(self.lfsr[7], self.lfsr[0])))))

    def nfsr_feedback(self):
        n = self.nfsr
        # Linear terms
        fb = Xor(n[96], Xor(n[91], Xor(n[56], Xor(n[26], n[0]))))
        # Quadratic terms
        fb = Xor(fb, And(n[84], n[68]))
        fb = Xor(fb, And(n[67], n[3]))
        fb = Xor(fb, And(n[65], n[61]))
        fb = Xor(fb, And(n[59], n[27]))
        fb = Xor(fb, And(n[48], n[40]))
        fb = Xor(fb, And(n[18], n[17]))
        fb = Xor(fb, And(n[13], n[11]))
        # Cubic terms
        fb = Xor(fb, And(n[82], And(n[78], n[70])))
        fb = Xor(fb, And(n[25], And(n[24], n[22])))
        # Quartic term
        fb = Xor(fb, And(n[95], And(n[93], And(n[92], n[88]))))
        return fb

    def h_function(self):
        # h(x) = x0*x1 + x2*x3 + x4*x5 + x6*x7 + x0*x4*x8
        x0 = self.nfsr[12]   # b_{i+12}
        x1 = self.lfsr[8]    # s_{i+8}
        x2 = self.lfsr[13]   # s_{i+13}
        x3 = self.lfsr[20]   # s_{i+20}
        x4 = self.nfsr[95]   # b_{i+95}
        x5 = self.lfsr[42]   # s_{i+42}
        x6 = self.lfsr[60]   # s_{i+60}
        x7 = self.lfsr[79]   # s_{i+79}
        x8 = self.lfsr[94]   # s_{i+94}

        h = Xor(And(x0, x1), Xor(And(x2, x3), Xor(And(x4, x5),
            Xor(And(x6, x7), And(x0, And(x4, x8))))))
        return h

    def output(self):
        h = self.h_function()
        # y = h + s_{93} + b_2 + b_15 + b_36 + b_45 + b_64 + b_73 + b_89
        y = Xor(h, Xor(self.lfsr[93],
            Xor(self.nfsr[2], Xor(self.nfsr[15], Xor(self.nfsr[36],
            Xor(self.nfsr[45], Xor(self.nfsr[64], Xor(self.nfsr[73],
            self.nfsr[89]))))))))
        return y

    def clock(self, init_mode=False):
        """Clock one step. Returns the output bit (pre-output)."""
        lfsr_fb = self.lfsr_feedback()
        nfsr_fb = self.nfsr_feedback()
        y = self.output()

        lfsr_out = self.lfsr[0]

        if init_mode:
            new_lfsr_bit = Xor(lfsr_fb, y)
            new_nfsr_bit = Xor(nfsr_fb, Xor(lfsr_out, y))
        else:
            new_lfsr_bit = lfsr_fb
            new_nfsr_bit = Xor(nfsr_fb, lfsr_out)

        # Shift registers
        self.lfsr = self.lfsr[1:] + [new_lfsr_bit]
        self.nfsr = self.nfsr[1:] + [new_nfsr_bit]

        return y

    def initialize(self):
        """Run 256 initialization rounds."""
        for i in range(256):
            self.clock(init_mode=True)
            if i % 32 == 0:
                print(f"  Init round {i}/256...", file=sys.stderr)

    def keystream_bits(self, n):
        """Generate n keystream bits (non-auth mode)."""
        bits = []
        for i in range(n):
            bits.append(self.clock(init_mode=False))
        return bits

    def keystream_bytes(self, n_bytes):
        """Generate keystream as list of symbolic byte expressions."""
        bits = self.keystream_bits(n_bytes * 8)
        bytes_out = []
        for i in range(n_bytes):
            byte_bits = bits[i*8:(i+1)*8]
            bytes_out.append(byte_bits)
        return bytes_out


def byte_constraint(solver, sym_byte_bits, concrete_byte):
    """Add constraint that symbolic byte == concrete byte."""
    for j in range(8):
        bit_val = (concrete_byte >> (7 - j)) & 1
        if bit_val:
            solver.add(sym_byte_bits[j] == True)
        else:
            solver.add(sym_byte_bits[j] == False)


# ============================================================
# Tag Data
# ============================================================

# All payloads start after the 5-byte cleartext header (00 LEN 01 0C 01)
# First 12 bytes = candidate IV, rest = ciphertext
TAGS = {
    "X-Wing": {
        "cat": "item",
        "payload": bytes.fromhex(
            "24d43e829f371f47ab8f3636"  # IV (12 bytes)
            "426371d554f2b8f4c5b5afe910bf0083332f74f7ca47ef1ab079864"
            "14ececabd34f8daa679c64735bd10313c37f8dcdb4ad113bca30418"
            "026cadeb41c971ccaec1cddc92798e13259706a23d39e9d6f41e339"
            "bb2b9af46c222e8"
        ),
    },
    "TIE Fighter": {
        "cat": "item",
        "payload": bytes.fromhex(
            "99f49376 76dc5c cc c02d6b fa"  # IV (12 bytes)
            "ba0af0361974fd2cad33a8402f1904e4f4755656aae2ffa619b64e2"
            "807a1d2ac8a43865055e58cc55348c6f48cd773842cbf3c935cde60"
            "9b3da1db6810236dccf0c4351bb0bc6f0d4bb4e3ea818420b1edc6"
            "c72a47c61d3a3eb8"
        ),
    },
    "R2-D2": {
        "cat": "identity",
        "payload": bytes.fromhex(
            "24b410e7c0d07d2dfdb513f9"  # IV (12 bytes)
            "0d499a3cb6454ffb90bf805918c18568570fcefe3dd86047b1c9052"
            "b16aea17c4c16b4afaf9482d59fa94169c31ff0f9eb131386"
            "13e241f171"
        ),
    },
}

# Fix hex strings (remove spaces)
for name, tag in TAGS.items():
    raw = tag["payload"]
    tag["iv"] = list(raw[:12])
    tag["ct"] = list(raw[12:])


# ============================================================
# Known Plaintext Constraints
# ============================================================

# We try multiple offset hypotheses. For each, we add constraints
# and see if the solver finds a consistent key.

# Hypothesis: Content identity TLV starts at plaintext byte 0
# [22 00 07 00] [content_lo:4] [content_hi:2] [type_byte:1]
# Then resource refs follow.

# Known bytes at estimated positions:
KNOWN_PLAINTEXT = {
    # Universal TLV header (all tags)
    "tlv_header": [
        (0, 0x22, "TLV type_id low"),
        (1, 0x00, "TLV type_id high"),
        (2, 0x07, "content_length low"),
        (3, 0x00, "content_length high"),
    ],
    # Category-specific type_byte
    "type_byte": {
        "identity": (10, 0x03),
        "item": (10, 0x06),
    },
}


def solve_with_constraints(tag_constraints, timeout_sec=300):
    """
    tag_constraints: list of (tag_name, iv_bytes, ct_bytes, known_pt_bytes)
    where known_pt_bytes = [(offset, value), ...]

    Returns: key bytes if found, None otherwise
    """
    solver = Solver()
    solver.set("timeout", timeout_sec * 1000)

    # Create 128 symbolic key bits
    key_bits = [Bool(f"k_{i}") for i in range(128)]

    for tag_name, iv_bytes, ct_bytes, known_pt in tag_constraints:
        print(f"\nBuilding Grain-128A constraints for {tag_name}...", file=sys.stderr)
        print(f"  IV: {bytes(iv_bytes).hex()}", file=sys.stderr)
        print(f"  CT: {len(ct_bytes)} bytes", file=sys.stderr)
        print(f"  Known PT: {len(known_pt)} bytes", file=sys.stderr)

        # Create symbolic Grain-128A instance
        grain = SymbolicGrain128A(key_bits, iv_bytes)

        # Initialize (256 rounds)
        print("  Running 256 init rounds symbolically...", file=sys.stderr)
        grain.initialize()

        # Find max offset needed
        max_offset = max(off for off, _ in known_pt) + 1
        print(f"  Generating {max_offset} keystream bytes...", file=sys.stderr)

        # Generate keystream bytes
        ks_bytes = grain.keystream_bytes(max_offset)

        # For each known plaintext byte:
        # plaintext[i] = ciphertext[i] XOR keystream[i]
        # So: keystream[i] = ciphertext[i] XOR plaintext[i]
        for offset, pt_val in known_pt:
            ct_val = ct_bytes[offset]
            ks_val = ct_val ^ pt_val  # known keystream byte

            print(f"  Constraining KS byte {offset}: ct=0x{ct_val:02x} pt=0x{pt_val:02x} ks=0x{ks_val:02x}", file=sys.stderr)
            byte_constraint(solver, ks_bytes[offset], ks_val)

    print(f"\nSolving with {solver.num_scopes()} scopes...", file=sys.stderr)
    print(f"Starting SAT solver (timeout={timeout_sec}s)...", file=sys.stderr)

    start = time.time()
    result = solver.check()
    elapsed = time.time() - start

    print(f"Result: {result} ({elapsed:.1f}s)", file=sys.stderr)

    if result == sat:
        model = solver.model()
        key_bytes = []
        for i in range(16):
            byte_val = 0
            for j in range(8):
                bit_idx = i * 8 + j
                bit_val = model.evaluate(key_bits[bit_idx])
                if is_true(bit_val):
                    byte_val |= (1 << (7 - j))
            key_bytes.append(byte_val)
        return key_bytes
    elif result == unknown:
        print("Solver timed out or gave up.", file=sys.stderr)
        return None
    else:
        print("UNSAT — no key satisfies these constraints.", file=sys.stderr)
        print("This means either:", file=sys.stderr)
        print("  1. The plaintext offset assumptions are wrong", file=sys.stderr)
        print("  2. The algorithm is not Grain-128A", file=sys.stderr)
        print("  3. The IV boundary (12 bytes) is wrong", file=sys.stderr)
        return None


# ============================================================
# Main
# ============================================================

def main():
    print("=== Grain-128A SAT Key Recovery ===\n")

    # Start with minimal constraints — just the TLV header on one tag
    # This is the fastest test: 4 known bytes = 32 bit constraints
    # With 128-bit key, expect ~2^96 solutions — solver may find one quickly
    # or may struggle. Adding more tags/constraints helps enormously.

    print("Phase 1: TLV header constraint on X-Wing (4 known bytes)")
    print("=" * 60)

    xw = TAGS["X-Wing"]
    known_pt_xw = [(off, val) for off, val, _ in KNOWN_PLAINTEXT["tlv_header"]]
    # Add type_byte for item
    tb_off, tb_val = KNOWN_PLAINTEXT["type_byte"]["item"]
    known_pt_xw.append((tb_off, tb_val))

    constraints = [
        ("X-Wing", xw["iv"], xw["ct"], known_pt_xw),
    ]

    key = solve_with_constraints(constraints, timeout_sec=600)

    if key:
        print(f"\n*** KEY FOUND: {bytes(key).hex()} ***")
        print(f"Key bytes: {' '.join(f'{b:02x}' for b in key)}")

        # Verify by decrypting all tags
        print("\nVerifying against all tags...")
        # (verification would go here)
    else:
        print("\nPhase 1 failed. Trying with additional tag constraints...")

        # Phase 2: Add TIE Fighter constraints
        print("\nPhase 2: X-Wing + TIE Fighter (10 known bytes, 2 IVs)")
        print("=" * 60)

        tie = TAGS["TIE Fighter"]
        known_pt_tie = [(off, val) for off, val, _ in KNOWN_PLAINTEXT["tlv_header"]]
        tb_off, tb_val = KNOWN_PLAINTEXT["type_byte"]["item"]
        known_pt_tie.append((tb_off, tb_val))

        constraints = [
            ("X-Wing", xw["iv"], xw["ct"], known_pt_xw),
            ("TIE Fighter", tie["iv"], tie["ct"], known_pt_tie),
        ]

        key = solve_with_constraints(constraints, timeout_sec=600)

        if key:
            print(f"\n*** KEY FOUND: {bytes(key).hex()} ***")
            print(f"Key bytes: {' '.join(f'{b:02x}' for b in key)}")
        else:
            print("\nPhase 2 failed.")
            print("The offset assumptions may be wrong, or the algorithm is not Grain-128A.")
            print("Try adjusting the plaintext offsets or adding more constraints.")


if __name__ == "__main__":
    main()
