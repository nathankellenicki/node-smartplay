#!/usr/bin/env python3
"""
Grain-128A Key Recovery using CryptoMiniSat with native XOR clauses.

CryptoMiniSat handles XOR clauses natively via Gaussian elimination,
which is dramatically more efficient than z3 for stream cipher analysis.

Variables:
  - 128 key bits (k_0 .. k_127)
  - Per tag: 256 LFSR bits + 256 NFSR bits per round snapshot (every 16 rounds)
  - Per tag: auxiliary AND variables (~20 per round × 267 rounds)

Total per tag: ~5400 AND-aux + ~4100 snapshot = ~10K vars
4 tags: ~40K vars + 128 shared key vars
"""

import sys
import time
from pycryptosat import Solver

class CMSGrain128A:
    """Grain-128A encoded as CryptoMiniSat clauses with native XOR."""

    def __init__(self, solver, key_var_start, iv_bytes, tag_name, var_counter):
        self.s = solver
        self.tag = tag_name
        self.vc = var_counter  # mutable list [next_var]

        # LFSR: IV bits (concrete True/False) + padding
        iv_bits = []
        for b in iv_bytes:
            for j in range(7, -1, -1):
                iv_bits.append(bool((b >> j) & 1))

        # Represent state as variable IDs (positive int) or None (for concrete values)
        # For concrete bits, we create a variable and immediately fix it
        self.lfsr = []
        for i, bit in enumerate(iv_bits):
            v = self._new_var()
            self.s.add_clause([v if bit else -v])
            self.lfsr.append(v)
        for i in range(96, 127):
            v = self._new_var()
            self.s.add_clause([v])  # = True
            self.lfsr.append(v)
        v = self._new_var()
        self.s.add_clause([-v])  # bit 127 = False
        self.lfsr.append(v)

        # NFSR: key variables
        self.nfsr = list(range(key_var_start, key_var_start + 128))

        self.round = 0

    def _new_var(self):
        v = self.vc[0]
        self.vc[0] += 1
        return v

    def _xor_vars(self, var_list, result_true=False):
        """Add XOR clause: var_list[0] ^ var_list[1] ^ ... = result_true.
        Returns a new variable equal to the XOR result."""
        result_var = self._new_var()
        # XOR clause: v1 ^ v2 ^ ... ^ result_var = result_true
        self.s.add_xor_clause(var_list + [result_var], result_true)
        return result_var

    def _xor2(self, a, b):
        """a XOR b = new var."""
        r = self._new_var()
        self.s.add_xor_clause([a, b, r], False)  # a ^ b ^ r = 0, so r = a ^ b
        return r

    def _xor_multi(self, vars_list):
        """XOR of multiple variables using a single native XOR clause."""
        if len(vars_list) == 1:
            return vars_list[0]
        if len(vars_list) == 2:
            return self._xor2(vars_list[0], vars_list[1])
        # CryptoMiniSat handles arbitrary-length XOR clauses natively
        r = self._new_var()
        self.s.add_xor_clause(vars_list + [r], False)  # xor of all + r = 0 → r = xor of all
        return r

    def _and2(self, a, b):
        """a AND b = new var, encoded as CNF clauses."""
        r = self._new_var()
        # r = a AND b:
        # (NOT a OR NOT b OR r) AND (a OR NOT r) AND (b OR NOT r)
        self.s.add_clause([-a, -b, r])
        self.s.add_clause([a, -r])
        self.s.add_clause([b, -r])
        return r

    def _and3(self, a, b, c):
        return self._and2(a, self._and2(b, c))

    def _and4(self, a, b, c, d):
        return self._and2(a, self._and3(b, c, d))

    def clock(self, init_mode):
        self.round += 1
        s = self.lfsr
        n = self.nfsr

        # LFSR feedback
        lf = self._xor_multi([s[96], s[81], s[70], s[38], s[7], s[0]])

        # NFSR feedback
        nf_lin = self._xor_multi([n[96], n[91], n[56], n[26], n[0]])
        nf_nl = self._xor_multi([
            self._and2(n[84], n[68]), self._and2(n[67], n[3]),
            self._and2(n[65], n[61]), self._and2(n[59], n[27]),
            self._and2(n[48], n[40]), self._and2(n[18], n[17]),
            self._and2(n[13], n[11]), self._and3(n[82], n[78], n[70]),
            self._and3(n[25], n[24], n[22]),
            self._and4(n[95], n[93], n[92], n[88]),
        ])
        nf = self._xor2(nf_lin, nf_nl)

        # h function
        h = self._xor_multi([
            self._and2(n[12], s[8]), self._and2(s[13], s[20]),
            self._and2(n[95], s[42]), self._and2(s[60], s[79]),
            self._and3(n[12], n[95], s[94]),
        ])

        # Output
        y = self._xor_multi([h, s[93], n[2], n[15], n[36], n[45], n[64], n[73], n[89]])

        lo = s[0]

        if init_mode:
            new_l = self._xor2(lf, y)
            new_n = self._xor_multi([nf, lo, y])
        else:
            new_l = lf
            new_n = self._xor2(nf, lo)

        self.lfsr = s[1:] + [new_l]
        self.nfsr = n[1:] + [new_n]

        return y

    def initialize(self):
        for i in range(256):
            self.clock(init_mode=True)
            if i % 64 == 0:
                print(f"  [{self.tag}] Init {i}/256 (vars: {self.vc[0]})", file=sys.stderr)
        print(f"  [{self.tag}] Init done. Total vars: {self.vc[0]}", file=sys.stderr)

    def constrain_keystream_byte(self, byte_idx, value):
        """Generate keystream bits up to byte_idx and constrain them."""
        bits = []
        for j in range(8):
            bits.append(self.clock(init_mode=False))
        # Constrain each bit
        for j in range(8):
            bit_val = (value >> (7 - j)) & 1
            if bit_val:
                self.s.add_clause([bits[j]])
            else:
                self.s.add_clause([-bits[j]])


def main():
    print("=== CryptoMiniSat Grain-128A Solver ===\n", file=sys.stderr)

    tags = [
        {
            "name": "xw",
            "iv": [0x24, 0xd4, 0x3e, 0x82, 0x9f, 0x37, 0x1f, 0x47, 0xab, 0x8f, 0x36, 0x36],
            "ct": bytes.fromhex(
                "426371d554f2b8f4c5b5afe910bf0083332f74f7ca47ef1ab07986414ececa"
                "bd34f8daa679c64735bd10313c37f8dcdb4ad113bca30418026cadeb41c971"
                "ccaec1cddc92798e13259706a23d39e9d6f41e339bb2b9af46c222e8"),
        },
        {
            "name": "tie",
            "iv": [0x99, 0xf4, 0x93, 0x76, 0x76, 0xdc, 0x5c, 0xcc, 0xc0, 0x2d, 0x6b, 0xfa],
            "ct": bytes.fromhex(
                "ba0af0361974fd2cad33a8402f1904e4f4755656aae2ffa619b64e2807a1d2"
                "ac8a43865055e58cc55348c6f48cd773842cbf3c935cde609b3da1db681023"
                "6dccf0c4351bb0bc6f0d4bb4e3ea818420b1edc6c72a47c61d3a3eb8"),
        },
        {
            "name": "fal",
            "iv": [0x05, 0x3b, 0x22, 0x03, 0xd9, 0xe8, 0x32, 0x4f, 0x7c, 0x45, 0xfd, 0xd0],
            "ct": bytes.fromhex(
                "f4cdc0b6f5a0ebba542c9c067646279aac64d640b7e9c6a1bb9ba5c5677ac9"
                "b314d6fbebbb397a24a0db194daff80c1e1a1097518e7aedd42f787519c3ae"
                "f023ade6d9403f9494c8ec06ffd4ff6593b159ab574331d7627a08ef"),
        },
        {
            "name": "aw",
            "iv": [0x72, 0x4c, 0xe6, 0x10, 0x3e, 0xc8, 0x7c, 0x94, 0xc9, 0x11, 0x17, 0x3b],
            "ct": bytes.fromhex(
                "608c0eedc6144be73bd6c17d741fb9942bc72ed5ddf21c112c4a953a486b27"
                "aded151e8f72a42e261a41a6d290378764a717d5b4e6f69df0fcd54e08b785"
                "05b5e54e03316ce69b2c693fd9ad916bc90ca8e9fd9cf5498f5badc0"),
        },
    ]

    # Known plaintext at corrected offsets
    known_pt = [
        (53, 0x03), (54, 0x18), (55, 0x00),
        (59, 0x10), (60, 0x04), (63, 0x02),
        (64, 0x12), (66, 0x08), (67, 0x00), (69, 0x00),
    ]

    # Compute known keystream per tag
    for tag in tags:
        tag["known_ks"] = [(pos, tag["ct"][pos] ^ pt) for pos, pt in known_pt if pos < len(tag["ct"])]

    solver = Solver(threads=4)

    # Variable numbering: CryptoMiniSat uses 1-based variables
    # key: vars 1-128
    key_start = 1
    var_counter = [129]  # next available variable

    total_aux = 0
    for tag in tags:
        print(f"\nBuilding {tag['name']}...", file=sys.stderr)
        grain = CMSGrain128A(solver, key_start, tag["iv"], tag["name"], var_counter)
        grain.initialize()

        # Generate keystream up to max needed position
        max_pos = max(pos for pos, _ in tag["known_ks"])

        # We need to generate bytes 0 through max_pos
        # But we only constrain specific bytes
        print(f"  [{tag['name']}] Generating keystream to byte {max_pos}...", file=sys.stderr)

        ks_byte_idx = 0
        for byte_idx in range(max_pos + 1):
            bits = []
            for j in range(8):
                bits.append(grain.clock(init_mode=False))

            # Check if this byte needs constraining
            for pos, ks_val in tag["known_ks"]:
                if pos == byte_idx:
                    for j in range(8):
                        bit_val = (ks_val >> (7 - j)) & 1
                        if bit_val:
                            solver.add_clause([bits[j]])
                        else:
                            solver.add_clause([-bits[j]])
                    print(f"  [{tag['name']}] Constrained byte {pos}: ks=0x{ks_val:02x}", file=sys.stderr)

        tag_vars = var_counter[0] - 129
        total_aux += tag_vars
        print(f"  [{tag['name']}] Done. Vars used: {tag_vars}", file=sys.stderr)

    print(f"\nTotal variables: {var_counter[0] - 1}", file=sys.stderr)
    print(f"Solving with CryptoMiniSat ({4} threads)...\n", file=sys.stderr)

    start = time.time()
    sat, solution = solver.solve()
    elapsed = time.time() - start

    print(f"Result: {'SAT' if sat else 'UNSAT'} ({elapsed:.1f}s)", file=sys.stderr)

    if sat:
        key_bytes = []
        for i in range(16):
            b = 0
            for j in range(8):
                var_idx = key_start + i * 8 + j  # 1-based
                if solution[var_idx]:
                    b |= (1 << (7 - j))
            key_bytes.append(b)
        key_hex = bytes(key_bytes).hex()
        print(f"\n*** KEY FOUND: {key_hex} ***")
        print(f"Key bytes: {' '.join(f'{b:02x}' for b in key_bytes)}")
        print(f"Time: {elapsed:.1f}s")
    else:
        print("\nUNSAT — no key satisfies all constraints.")
        print("Some plaintext offset assumptions may be wrong.")


if __name__ == "__main__":
    main()
