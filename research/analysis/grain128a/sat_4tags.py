#!/usr/bin/env python3
"""
Grain-128A SAT Solver with 4 Tags × 10 Known Bytes = 320 bits constraint.

Uses flat z3 encoding with all 4 ship tags sharing the same 128 key variables.
Each tag adds its own Grain-128A instance with its own IV and state variables,
but all constrain the same key bits.
"""

import sys
import time
from z3 import *

def build_grain_constraints(solver, key_vars, iv_bytes, known_ks, tag_name, timeout_rounds=256):
    """Build Grain-128A constraints for one tag."""

    # IV bits (concrete)
    iv_bits = []
    for b in iv_bytes:
        for j in range(7, -1, -1):
            iv_bits.append(BoolVal(bool((b >> j) & 1)))

    lfsr = list(iv_bits) + [BoolVal(True)] * 31 + [BoolVal(False)]
    nfsr = list(key_vars)

    aux_cnt = [0]
    def aux():
        aux_cnt[0] += 1
        return Bool(f"{tag_name}_a{aux_cnt[0]}")

    def xor2(a, b):
        r = aux(); solver.add(r == Xor(a, b)); return r
    def xor_multi(bits):
        if len(bits) == 1: return bits[0]
        if len(bits) == 2: return xor2(bits[0], bits[1])
        m = len(bits) // 2
        return xor2(xor_multi(bits[:m]), xor_multi(bits[m:]))
    def and2(a, b):
        r = aux(); solver.add(r == And(a, b)); return r
    def and3(a, b, c): return and2(a, and2(b, c))
    def and4(a, b, c, d): return and2(a, and3(b, c, d))

    def clock(init, rd):
        nonlocal lfsr, nfsr
        lf = xor_multi([lfsr[96], lfsr[81], lfsr[70], lfsr[38], lfsr[7], lfsr[0]])
        nf_lin = xor_multi([nfsr[96], nfsr[91], nfsr[56], nfsr[26], nfsr[0]])
        nf_nl = xor_multi([
            and2(nfsr[84], nfsr[68]), and2(nfsr[67], nfsr[3]),
            and2(nfsr[65], nfsr[61]), and2(nfsr[59], nfsr[27]),
            and2(nfsr[48], nfsr[40]), and2(nfsr[18], nfsr[17]),
            and2(nfsr[13], nfsr[11]), and3(nfsr[82], nfsr[78], nfsr[70]),
            and3(nfsr[25], nfsr[24], nfsr[22]),
            and4(nfsr[95], nfsr[93], nfsr[92], nfsr[88]),
        ])
        nf = xor2(nf_lin, nf_nl)
        h = xor_multi([
            and2(nfsr[12], lfsr[8]), and2(lfsr[13], lfsr[20]),
            and2(nfsr[95], lfsr[42]), and2(lfsr[60], lfsr[79]),
            and3(nfsr[12], nfsr[95], lfsr[94]),
        ])
        y = xor_multi([h, lfsr[93], nfsr[2], nfsr[15], nfsr[36],
                        nfsr[45], nfsr[64], nfsr[73], nfsr[89]])
        lo = lfsr[0]
        if init:
            new_l = xor2(lf, y)
            new_n = xor_multi([nf, lo, y])
        else:
            new_l = lf
            new_n = xor2(nf, lo)

        lfsr = lfsr[1:] + [new_l]
        nfsr = nfsr[1:] + [new_n]

        # Cut chains every 16 rounds
        if rd % 16 == 0:
            nl = []
            for i in range(128):
                v = Bool(f"{tag_name}_s{i}_r{rd}"); solver.add(v == lfsr[i]); nl.append(v)
            nn = []
            for i in range(128):
                v = Bool(f"{tag_name}_n{i}_r{rd}"); solver.add(v == nfsr[i]); nn.append(v)
            lfsr = nl; nfsr = nn

        return y

    # Init rounds
    print(f"  [{tag_name}] Building {timeout_rounds} init rounds...", file=sys.stderr)
    for r in range(timeout_rounds):
        clock(True, r)
        if r % 64 == 0:
            print(f"  [{tag_name}] Init round {r}/{timeout_rounds} (aux: {aux_cnt[0]})", file=sys.stderr)
    print(f"  [{tag_name}] Init done. Aux vars: {aux_cnt[0]}", file=sys.stderr)

    # Generate keystream and add constraints
    max_byte = max(pos for pos, _ in known_ks) + 1
    print(f"  [{tag_name}] Generating {max_byte} keystream bytes...", file=sys.stderr)

    ks_bits_all = []
    for r in range(max_byte * 8):
        ks_bits_all.append(clock(False, timeout_rounds + r))

    for pos, ks_val in known_ks:
        for j in range(8):
            bit = (ks_val >> (7 - j)) & 1
            solver.add(ks_bits_all[pos * 8 + j] == BoolVal(bool(bit)))
        print(f"  [{tag_name}] Constrained KS byte {pos}: 0x{ks_val:02x}", file=sys.stderr)

    return aux_cnt[0]


def main():
    print("=== Grain-128A 4-Tag SAT Solver (320-bit constraint) ===\n", file=sys.stderr)

    # Tag IVs and known keystream bytes
    tags = [
        {
            "name": "xw",
            "iv": [0x24, 0xd4, 0x3e, 0x82, 0x9f, 0x37, 0x1f, 0x47, 0xab, 0x8f, 0x36, 0x36],
            "ct": bytes.fromhex("426371d554f2b8f4c5b5afe910bf008333"
                "2f74f7ca47ef1ab079864"
                "14ececabd34f8daa679c64735bd10313c37f8dcdb4ad113bca30418"
                "026cadeb41c971ccaec1cddc92798e13259706a23d39e9d6f41e339"
                "bb2b9af46c222e8"),
        },
        {
            "name": "tie",
            "iv": [0x99, 0xf4, 0x93, 0x76, 0x76, 0xdc, 0x5c, 0xcc, 0xc0, 0x2d, 0x6b, 0xfa],
            "ct": bytes.fromhex("ba0af0361974fd2cad33a8402f1904e4f4"
                "755656aae2ffa619b64e2"
                "807a1d2ac8a43865055e58cc55348c6f48cd773842cbf3c935cde60"
                "9b3da1db6810236dccf0c4351bb0bc6f0d4bb4e3ea818420b1edc6"
                "c72a47c61d3a3eb8"),
        },
        {
            "name": "fal",
            "iv": [0x05, 0x3b, 0x22, 0x03, 0xd9, 0xe8, 0x32, 0x4f, 0x7c, 0x45, 0xfd, 0xd0],
            "ct": bytes.fromhex("f4cdc0b6f5a0ebba542c9c067646279aac"
                "64d640b7e9c6a1bb9ba5c"
                "5677ac9b314d6fbebbb397a24a0db194daff80c1e1a1097518e7aed"
                "d42f787519c3aef023ade6d9403f9494c8ec06ffd4ff6593b159ab5"
                "74331d7627a08ef"),
        },
        {
            "name": "aw",
            "iv": [0x72, 0x4c, 0xe6, 0x10, 0x3e, 0xc8, 0x7c, 0x94, 0xc9, 0x11, 0x17, 0x3b],
            "ct": bytes.fromhex("608c0eedc6144be73bd6c17d741fb9942b"
                "c72ed5ddf21c112c4a953"
                "a486b27aded151e8f72a42e261a41a6d2903787"
                "64a717d5b4e6f69df0fcd54e08b78505b5e54e03316ce69b2c693fd9"
                "ad916bc90ca8e9fd9cf5498f5badc0"),
        },
    ]

    # Known plaintext bytes (corrected offsets from dispatch trace)
    known_pt = [
        (53, 0x03),  # timer sub-record length
        (54, 0x18),  # timer content_ref lo = 24
        (55, 0x00),  # timer content_ref hi
        (59, 0x10),  # button sub-record length = 16
        (60, 0x04),  # button framing byte
        (63, 0x02),  # button inner_type (resource ref)
        (64, 0x12),  # button tag_byte
        (66, 0x08),  # button sub_type lo
        (67, 0x00),  # button sub_type hi
        (69, 0x00),  # button content_ref hi
    ]

    # Compute known keystream bytes per tag
    for tag in tags:
        tag["known_ks"] = []
        for pos, pt_val in known_pt:
            if pos < len(tag["ct"]):
                ks_val = tag["ct"][pos] ^ pt_val
                tag["known_ks"].append((pos, ks_val))

    solver = Solver()
    solver.set("timeout", 3600 * 1000)  # 1 hour

    # Shared key variables
    key_vars = [Bool(f"k_{i}") for i in range(128)]

    total_aux = 0
    for tag in tags:
        aux = build_grain_constraints(
            solver, key_vars, tag["iv"], tag["known_ks"], tag["name"]
        )
        total_aux += aux

    print(f"\nTotal aux vars across all tags: {total_aux}", file=sys.stderr)
    print(f"Total constraints: {len(known_pt)} bytes × {len(tags)} tags = {len(known_pt)*len(tags)} keystream bytes", file=sys.stderr)
    print(f"Starting solver (1 hour timeout)...\n", file=sys.stderr)

    start = time.time()
    result = solver.check()
    elapsed = time.time() - start

    print(f"Result: {result} ({elapsed:.1f}s)", file=sys.stderr)

    if result == sat:
        model = solver.model()
        key_bytes = []
        for i in range(16):
            b = 0
            for j in range(8):
                if is_true(model.evaluate(key_vars[i * 8 + j])):
                    b |= (1 << (7 - j))
            key_bytes.append(b)
        key_hex = bytes(key_bytes).hex()
        print(f"\n*** KEY FOUND: {key_hex} ***")
        print(f"Key bytes: {' '.join(f'{b:02x}' for b in key_bytes)}")
        print(f"Time: {elapsed:.1f}s")
    elif result == unknown:
        print("\nSolver timed out after 1 hour.")
        print("Try CryptoMiniSat with native XOR clauses.")
    else:
        print("\nUNSAT — no key satisfies all constraints.")
        print("Some plaintext offset assumptions are likely wrong.")


if __name__ == "__main__":
    main()
