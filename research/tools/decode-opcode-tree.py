#!/usr/bin/env python3
"""
Decode the opcode stream tree from firmware ROM.

The play engine uses a dual-stream architecture:
  - Opcode stream at ROM 0x37BCF4 (~16KB): handler IDs defining output format schema
  - Data stream from play.bin: values conforming to the schema
  - Secondary table at ROM 0x37BA00 (756 bytes): per-record data strides for counted_loop

Each opcode position defines a "schema node" that describes how to read data and
format output. 20 unique entry positions are used by the firmware, each representing
a different output packet format.
"""

import sys
import os

FW_PATH = os.path.join(os.path.dirname(__file__), "../randomfiles/firmware/smartbrick_v0.72.1_code.bin")

OPCODE_BASE = 0x37BCF4 - 0x306000  # File offset of opcode stream
SECONDARY_BASE = 0x37BA00 - 0x306000  # File offset of secondary table

HANDLER_NAMES = {
    0: "cond_exec",      # No data read; writes NOP/sync to output
    1: "eval_expr",      # Reads u8 from data[0]
    2: "write_u8",       # Reads u8 from data[0]
    3: "write_u16",      # Reads u16 from data[0:2]
    4: "write_u32",      # Reads u32 from data[0:4]
    5: "write_f64",      # Reads 8 bytes from data[0:8]
    6: "write_i8",       # Reads i8 from data[0]
    7: "write_i16",      # Reads i16 from data[0:2]
    8: "write_i32",      # Reads i32 from data[0:4] (actually from 4e658 path)
    9: "write_i64",      # Reads 8 bytes from data[0:8]
    10: "write_typed_f",  # Reads u32 from data[0:4], writes as float
    11: "NOP",           # End marker - no data
    12: "if_then",       # Reads u8 condition from data, continues to next handler
    13: "if_else",       # Reads 2 bytes cond, recurses then/else branches
    14: "cnt_loop",      # 4 opcodes [handler, count, lo, hi]; iterates with secondary table
    15: "range_chk",     # 3 opcodes; reads u32+u32 (8 bytes range data)
    16: "range_sgn",     # 3 opcodes; reads signed range data
    17: "eq_check",      # 3 opcodes; reads equality check data
    18: "nest_loop",     # 3 opcodes; similar to counted_loop variant
    19: "nest_stride",   # 3 opcodes; nested loop with stride
    20: "bricknet",      # 3 opcodes; PAwR messaging
    21: "cond_skip",     # 2 opcodes; reads u8, advances data by op[1] if nonzero
    22: "recurse",       # 2 opcodes; jumps to position=op[1]
    23: "recurse16",     # 3 opcodes; jumps to position=(op[2]<<8|op[1])
    24: "type_disp",     # 2 opcodes; dispatch on op[1] for typed data write
}

TYPE_DISPATCH_NAMES = {
    1: "u8", 2: "u16", 4: "u32", 8: "f64",
    129: "i8", 130: "i16", 132: "i32", 136: "i64",
}

DATA_SIZES = {
    0: 0, 1: 1, 2: 1, 3: 2, 4: 4, 5: 8,
    6: 1, 7: 2, 8: 4, 9: 8, 10: 4, 11: 0,
}

# Known entry positions from firmware callers
ENTRY_POSITIONS = [185, 279, 425, 430, 546, 626, 653, 656, 659, 741,
                   963, 1140, 1210, 1229, 1231, 1314, 1329, 1365, 1476, 1584]


def load_firmware():
    with open(FW_PATH, "rb") as f:
        return f.read()


def decode_tree(fw, start_pos, max_depth=20, visited=None):
    """Decode the opcode tree starting at a given position.

    Returns a list of (indent, text, pos, handler_id) entries.
    """
    if visited is None:
        visited = set()

    opcodes = fw[OPCODE_BASE:]
    secondary = fw[SECONDARY_BASE:]

    output = []
    pos = start_pos
    indent = 0

    def emit(text, p=None, hid=None):
        output.append((indent, text, p if p is not None else pos, hid))

    # Walk the tree - handlers 12, 21 continue; others return
    safety = 0
    while safety < 500:
        safety += 1
        if pos >= len(opcodes):
            emit(f"END (pos {pos} out of range)")
            break

        byte = opcodes[pos]
        if byte == 0:
            emit(f"[{pos:4d}] END (byte=0x00)")
            break

        handler = byte - 1
        if handler > 24:
            emit(f"[{pos:4d}] OPERAND 0x{byte:02x} (not a handler)")
            break

        name = HANDLER_NAMES.get(handler, f"h{handler}")
        cur_pos = pos

        if handler == 11:  # NOP - end marker
            emit(f"[{pos:4d}] NOP", cur_pos, handler)
            pos += 1
            break

        elif handler in (0, 1):  # cond_exec, eval_expr
            data_info = "no_data" if handler == 0 else "data[0]:u8"
            emit(f"[{pos:4d}] {name}  ({data_info})", cur_pos, handler)
            pos += 1
            break  # RETURN handlers

        elif handler in range(2, 11):  # write handlers
            sz = DATA_SIZES.get(handler, "?")
            emit(f"[{pos:4d}] {name}  (data[0]:{sz}B)", cur_pos, handler)
            pos += 1
            break  # RETURN handlers

        elif handler == 12:  # if_then - CONTINUES
            emit(f"[{pos:4d}] if_then  (cond=data[0]:u8)", cur_pos, handler)
            pos += 1
            # continues to next handler

        elif handler == 13:  # if_then_else
            data_skip = opcodes[pos + 1] if pos + 1 < len(opcodes) else 0
            emit(f"[{pos:4d}] if_else  (cond=data[0:2], else_data_skip={data_skip})", cur_pos, handler)
            pos += 2

            # Recurse for "then" branch
            indent += 1
            emit(f"THEN:")
            then_tree = decode_tree(fw, pos, max_depth - 1, visited)
            for (ti, tt, tp, th) in then_tree:
                output.append((indent + ti, tt, tp, th))
            # Find updated position after then branch
            if then_tree:
                last = then_tree[-1]
                # The then branch consumes opcodes; we need to figure out where pos ends up
                # For now, note we'd need runtime position tracking
            indent -= 1

            indent += 1
            emit(f"ELSE:")
            # else branch starts at whatever position the then branch left us at
            # Without runtime tracking, we can only note the structure
            emit(f"(position depends on THEN branch length)")
            indent -= 1
            break  # Complex - would need position tracking

        elif handler == 14:  # counted_loop
            if pos + 3 >= len(opcodes):
                emit(f"[{pos:4d}] cnt_loop  (truncated)")
                break
            count = opcodes[pos + 1]
            lo = opcodes[pos + 2]
            hi = opcodes[pos + 3]
            sec_offset = (hi << 8) | lo

            # Read secondary table entries
            sec_bytes = []
            for i in range(count):
                if sec_offset + i < len(secondary):
                    sec_bytes.append(secondary[sec_offset + i])
                else:
                    sec_bytes.append(0)

            sec_str = ",".join(str(b) for b in sec_bytes)
            emit(f"[{pos:4d}] cnt_loop  count={count} sec_off=0x{sec_offset:03x} strides=[{sec_str}]", cur_pos, handler)
            pos += 4

            # Recurse into the body (first iteration)
            if max_depth > 0:
                indent += 1
                body_tree = decode_tree(fw, pos, max_depth - 1, visited)
                for (ti, tt, tp, th) in body_tree:
                    output.append((indent + ti, tt, tp, th))
                indent -= 1

            break  # RETURN handler

        elif handler == 15:  # range_check
            limit_hi = opcodes[pos + 1] if pos + 1 < len(opcodes) else 0
            limit_lo = opcodes[pos + 2] if pos + 2 < len(opcodes) else 0
            limit = (limit_hi << 8) | limit_lo
            emit(f"[{pos:4d}] range_chk  limit={limit} (data[0:4]:u32, data[4:8]:u32)", cur_pos, handler)
            pos += 3
            break

        elif handler == 16:  # range_signed
            limit_hi = opcodes[pos + 1] if pos + 1 < len(opcodes) else 0
            limit_lo = opcodes[pos + 2] if pos + 2 < len(opcodes) else 0
            limit = (limit_hi << 8) | limit_lo
            emit(f"[{pos:4d}] range_sgn  limit={limit}", cur_pos, handler)
            pos += 3
            break

        elif handler == 17:  # eq_check
            exp_lo = opcodes[pos + 1] if pos + 1 < len(opcodes) else 0
            exp_hi = opcodes[pos + 2] if pos + 2 < len(opcodes) else 0
            expect = (exp_hi << 8) | exp_lo
            emit(f"[{pos:4d}] eq_check  expect={expect}", cur_pos, handler)
            pos += 3
            break

        elif handler == 18:  # nested_loop
            stride = opcodes[pos + 1] if pos + 1 < len(opcodes) else 0
            count = opcodes[pos + 2] if pos + 2 < len(opcodes) else 0
            emit(f"[{pos:4d}] nest_loop  stride={stride} count={count}", cur_pos, handler)
            pos += 3
            # Recurse
            if max_depth > 0 and count > 0:
                indent += 1
                body = decode_tree(fw, pos, max_depth - 1, visited)
                for (ti, tt, tp, th) in body:
                    output.append((indent + ti, tt, tp, th))
                indent -= 1
            break

        elif handler == 19:  # nested_stride
            count = opcodes[pos + 1] if pos + 1 < len(opcodes) else 0
            stride = opcodes[pos + 2] if pos + 2 < len(opcodes) else 0
            emit(f"[{pos:4d}] nest_stride  count={count} stride={stride}", cur_pos, handler)
            pos += 3
            if max_depth > 0 and count > 0:
                indent += 1
                body = decode_tree(fw, pos, max_depth - 1, visited)
                for (ti, tt, tp, th) in body:
                    output.append((indent + ti, tt, tp, th))
                indent -= 1
            break

        elif handler == 20:  # bricknet
            adv = opcodes[pos + 1] if pos + 1 < len(opcodes) else 0
            out_off = opcodes[pos + 2] if pos + 2 < len(opcodes) else 0
            emit(f"[{pos:4d}] bricknet  advance={adv} out_off={out_off}", cur_pos, handler)
            pos += 3
            if max_depth > 0:
                indent += 1
                body = decode_tree(fw, pos, max_depth - 1, visited)
                for (ti, tt, tp, th) in body:
                    output.append((indent + ti, tt, tp, th))
                indent -= 1
            break

        elif handler == 21:  # cond_skip - CONTINUES
            skip = opcodes[pos + 1] if pos + 1 < len(opcodes) else 0
            emit(f"[{pos:4d}] cond_skip  data_advance={skip} (cond=data[0]:u8)", cur_pos, handler)
            pos += 2
            # continues to next handler

        elif handler == 22:  # recurse
            target = opcodes[pos + 1] if pos + 1 < len(opcodes) else 0
            emit(f"[{pos:4d}] recurse  target_pos={target}", cur_pos, handler)
            pos += 2
            if max_depth > 0 and target not in visited:
                visited.add(target)
                indent += 1
                body = decode_tree(fw, target, max_depth - 1, visited)
                for (ti, tt, tp, th) in body:
                    output.append((indent + ti, tt, tp, th))
                indent -= 1
            break

        elif handler == 23:  # recurse16
            lo = opcodes[pos + 1] if pos + 1 < len(opcodes) else 0
            hi = opcodes[pos + 2] if pos + 2 < len(opcodes) else 0
            target = (hi << 8) | lo
            emit(f"[{pos:4d}] recurse16  target_pos={target}", cur_pos, handler)
            pos += 3
            if max_depth > 0 and target not in visited:
                visited.add(target)
                indent += 1
                body = decode_tree(fw, target, max_depth - 1, visited)
                for (ti, tt, tp, th) in body:
                    output.append((indent + ti, tt, tp, th))
                indent -= 1
            break

        elif handler == 24:  # type_dispatch
            disc = opcodes[pos + 1] if pos + 1 < len(opcodes) else 0
            type_name = TYPE_DISPATCH_NAMES.get(disc, f"type_{disc}")
            emit(f"[{pos:4d}] type_disp  type={type_name}({disc})", cur_pos, handler)
            pos += 2
            break

        else:
            emit(f"[{pos:4d}] UNKNOWN handler={handler}")
            break

    return output


def format_tree(entries):
    """Format tree entries into readable text."""
    lines = []
    for (indent, text, pos, hid) in entries:
        lines.append("  " * indent + text)
    return "\n".join(lines)


def main():
    fw = load_firmware()

    positions = ENTRY_POSITIONS
    if len(sys.argv) > 1:
        if sys.argv[1] == "--all":
            pass  # use all positions
        else:
            positions = [int(x) for x in sys.argv[1:]]

    for pos in positions:
        print(f"\n{'='*70}")
        print(f"OPCODE TREE at position {pos} (0x{pos:04x})")
        print(f"{'='*70}")
        tree = decode_tree(fw, pos, max_depth=10)
        print(format_tree(tree))


if __name__ == "__main__":
    main()
