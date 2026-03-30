#!/usr/bin/env python3
"""
Complete play engine data parser.

Walks the opcode tree from firmware ROM, tracking both position advancement
and data consumption. Can parse actual play.bin script data against the
opcode schema.

Architecture (from RE of executor 0x4E288):
  - r14 = DATA pointer (play.bin script data)
  - r15 = pointer to word holding current POSITION in opcode stream
  - Position advances through consecutive opcodes
  - cnt_loop strides advance DATA pointer between iterations
  - nest_loop resets position each iteration, advances DATA by stride
  - r14 is callee-saved: strides = total data consumed per iteration
"""

import sys
import os
import struct
import json

FW_PATH = os.path.join(os.path.dirname(__file__), "../randomfiles/firmware/smartbrick_v0.72.1_code.bin")
PLAY_PATH = os.path.join(os.path.dirname(__file__), "../randomfiles/firmware/play.bin")

OPCODE_FILE_BASE = 0x37BCF4 - 0x306000
SECONDARY_FILE_BASE = 0x37BA00 - 0x306000

HANDLER_NAMES = {
    0: "cond_exec", 1: "eval_expr", 2: "write_u8", 3: "write_u16",
    4: "write_u32", 5: "write_f64", 6: "write_i8", 7: "write_i16",
    8: "write_i32", 9: "write_i64", 10: "write_typed_f", 11: "NOP",
    12: "if_then", 13: "if_else", 14: "cnt_loop", 15: "range_chk",
    16: "range_sgn", 17: "eq_check", 18: "nest_loop", 19: "nest_stride",
    20: "bricknet", 21: "cond_skip", 22: "recurse", 23: "recurse16",
    24: "type_disp",
}

# How many bytes of data each terminal handler reads
DATA_SIZES = {
    0: 0, 1: 1, 2: 1, 3: 2, 4: 4, 5: 8,
    6: 1, 7: 2, 8: 4, 9: 8, 10: 4, 11: 0,
}

TYPE_DISPATCH_SIZES = {
    1: 1, 2: 2, 4: 4, 8: 8,
    129: 1, 130: 2, 132: 4, 136: 8,
}

TYPE_DISPATCH_NAMES = {
    1: "u8", 2: "u16", 4: "u32", 8: "f64",
    129: "i8", 130: "i16", 132: "i32", 136: "i64",
}


class OpcodeStream:
    """Represents the ROM opcode stream and secondary table."""
    def __init__(self, fw_data):
        self.opcodes = fw_data[OPCODE_FILE_BASE:]
        self.secondary = fw_data[SECONDARY_FILE_BASE:]

    def byte(self, pos):
        if 0 <= pos < len(self.opcodes):
            return self.opcodes[pos]
        return 0

    def handler_at(self, pos):
        """Get handler ID at position, or -1 if not a handler."""
        b = self.byte(pos)
        if b == 0:
            return -1
        h = b - 1
        return h if h <= 24 else -1

    def secondary_byte(self, offset):
        if 0 <= offset < len(self.secondary):
            return self.secondary[offset]
        return 0


class SchemaNode:
    """A node in the opcode schema tree."""
    def __init__(self, handler, pos, **kwargs):
        self.handler = handler
        self.pos = pos
        self.name = HANDLER_NAMES.get(handler, f"h{handler}")
        self.children = []
        self.attrs = kwargs  # handler-specific attributes

    def __repr__(self):
        return f"SchemaNode({self.name}@{self.pos}, {self.attrs})"


def decode_schema(stream, start_pos, max_depth=20):
    """Decode opcode schema tree starting at position.

    Returns (node, end_pos) where end_pos is the position AFTER
    this node's opcode bytes (for cnt_loop iteration tracking).

    This precisely models executor 0x4E288's position advancement.
    """
    pos = start_pos
    # Handle continuation handlers (if_then, cond_skip) by chaining
    chain = []

    while True:
        h = stream.handler_at(pos)
        if h < 0:
            node = SchemaNode(-1, pos, byte=stream.byte(pos))
            chain.append(node)
            pos += 1
            break

        if h == 11:  # NOP
            node = SchemaNode(11, pos)
            chain.append(node)
            pos += 1
            break

        elif h in (0, 1):  # cond_exec, eval_expr — terminal
            node = SchemaNode(h, pos, data_size=DATA_SIZES[h])
            chain.append(node)
            pos += 1
            break

        elif 2 <= h <= 10:  # write_* — terminal
            node = SchemaNode(h, pos, data_size=DATA_SIZES[h])
            chain.append(node)
            pos += 1
            break

        elif h == 12:  # if_then — CONTINUES
            # In executor: outputs 1, no data consumed, continues to next handler
            node = SchemaNode(12, pos)
            chain.append(node)
            pos += 1
            # continues — loop back to process next handler

        elif h == 13:  # if_else
            data_skip = stream.byte(pos + 1)
            node = SchemaNode(13, pos, data_skip=data_skip)
            pos += 2
            # Then branch: recursive decode at current position
            then_node, then_end = decode_schema(stream, pos, max_depth - 1)
            node.children.append(('then', then_node))
            # The then branch advances position
            # After then: data pointer skips by data_skip
            # Then continues to next handler for else branch
            chain.append(node)
            pos = then_end
            # continues — process next handler (else branch)

        elif h == 14:  # cnt_loop
            count = stream.byte(pos + 1)
            lo = stream.byte(pos + 2)
            hi = stream.byte(pos + 3)
            sec_offset = (hi << 8) | lo
            strides = [stream.secondary_byte(sec_offset + i) for i in range(count)]
            node = SchemaNode(14, pos, count=count, sec_offset=sec_offset, strides=strides)
            pos += 4  # advance past the 4 opcode bytes
            body_pos = pos
            # Decode each iteration — they walk CONSECUTIVE positions
            for i in range(count):
                iter_node, iter_end = decode_schema(stream, body_pos, max_depth - 1)
                node.children.append((f'iter{i}', iter_node, strides[i]))
                body_pos = iter_end  # next iteration starts where this one ended
            chain.append(node)
            pos = body_pos  # position after all iterations
            break  # cnt_loop is a RETURN handler

        elif h == 15:  # range_chk
            hi = stream.byte(pos + 1)
            lo = stream.byte(pos + 2)
            limit = (hi << 8) | lo
            node = SchemaNode(15, pos, limit=limit, data_size=8)
            chain.append(node)
            pos += 3
            break

        elif h == 16:  # range_sgn
            hi = stream.byte(pos + 1)
            lo = stream.byte(pos + 2)
            limit = (hi << 8) | lo
            node = SchemaNode(16, pos, limit=limit, data_size=8)
            chain.append(node)
            pos += 3
            break

        elif h == 17:  # eq_check
            lo = stream.byte(pos + 1)
            hi = stream.byte(pos + 2)
            expect = (hi << 8) | lo
            node = SchemaNode(17, pos, expect=expect)
            chain.append(node)
            pos += 3
            break

        elif h == 18:  # nest_loop
            stride = stream.byte(pos + 1)
            count = stream.byte(pos + 2)
            node = SchemaNode(18, pos, stride=stride, count=count)
            pos += 3
            # Body is at current pos, SAME position each iteration
            if count > 0 and max_depth > 0:
                body_node, body_end = decode_schema(stream, pos, max_depth - 1)
                node.children.append(('body', body_node))
                pos = body_end  # position after body opcodes
            chain.append(node)
            break

        elif h == 19:  # nest_stride
            offset_val = stream.byte(pos + 1)
            stride = stream.byte(pos + 2)
            # NOTE: count comes from DATA at runtime (4 bytes)
            node = SchemaNode(19, pos, offset=offset_val, stride=stride)
            pos += 3
            if max_depth > 0:
                body_node, body_end = decode_schema(stream, pos, max_depth - 1)
                node.children.append(('body', body_node))
                pos = body_end
            chain.append(node)
            break

        elif h == 20:  # bricknet
            adv = stream.byte(pos + 1)
            out_off = stream.byte(pos + 2)
            node = SchemaNode(20, pos, advance=adv, out_offset=out_off)
            pos += 3
            if max_depth > 0:
                body_node, body_end = decode_schema(stream, pos, max_depth - 1)
                node.children.append(('body', body_node))
                pos = body_end
            chain.append(node)
            break

        elif h == 21:  # cond_skip — CONTINUES
            skip = stream.byte(pos + 1)
            node = SchemaNode(21, pos, skip=skip)
            chain.append(node)
            pos += 2
            # continues — process next handler

        elif h == 22:  # recurse
            target = stream.byte(pos + 1)
            node = SchemaNode(22, pos, target=target)
            pos += 2
            # Body is at TARGET position, not current — doesn't advance pos
            if max_depth > 0:
                body_node, _ = decode_schema(stream, target, max_depth - 1)
                node.children.append(('target', body_node))
            chain.append(node)
            break

        elif h == 23:  # recurse16
            lo = stream.byte(pos + 1)
            hi = stream.byte(pos + 2)
            target = (hi << 8) | lo
            node = SchemaNode(23, pos, target=target)
            pos += 3
            if max_depth > 0:
                body_node, _ = decode_schema(stream, target, max_depth - 1)
                node.children.append(('target', body_node))
            chain.append(node)
            break

        elif h == 24:  # type_dispatch
            disc = stream.byte(pos + 1)
            type_name = TYPE_DISPATCH_NAMES.get(disc, f"type_{disc}")
            data_size = TYPE_DISPATCH_SIZES.get(disc, 0)
            node = SchemaNode(24, pos, disc=disc, type_name=type_name, data_size=data_size)
            chain.append(node)
            pos += 2
            break

        else:
            node = SchemaNode(h, pos)
            chain.append(node)
            pos += 1
            break

    # If we have a chain (from continuation handlers), wrap in a sequence
    if len(chain) == 1:
        return chain[0], pos
    else:
        seq = SchemaNode(-2, start_pos)  # -2 = sequence
        seq.name = "sequence"
        seq.children = [('step', n) for n in chain]
        return seq, pos


def format_schema(node, indent=0, prefix=""):
    """Format schema tree as readable text."""
    lines = []
    pad = "  " * indent

    if node.handler == -2:  # sequence
        for label, child in node.children:
            lines.extend(format_schema(child, indent, prefix))
        return lines

    h = node.handler
    name = node.name

    if h == 14:  # cnt_loop
        strides = node.attrs['strides']
        count = node.attrs['count']
        total_data = sum(strides)
        lines.append(f"{pad}[{node.pos:4d}] cnt_loop count={count} strides={strides} (total_data={total_data}B)")
        for label, child, stride in node.children:
            lines.append(f"{pad}  {label} (stride={stride}B):")
            lines.extend(format_schema(child, indent + 2))
        return lines

    elif h == 18:  # nest_loop
        s = node.attrs['stride']
        c = node.attrs['count']
        lines.append(f"{pad}[{node.pos:4d}] nest_loop stride={s} count={c} (total_data={s*c}B)")
        for label, child in node.children:
            lines.extend(format_schema(child, indent + 1))
        return lines

    elif h == 19:  # nest_stride
        o = node.attrs['offset']
        s = node.attrs['stride']
        lines.append(f"{pad}[{node.pos:4d}] nest_stride offset={o} stride={s} (count from data, total=4+count*{s}B)")
        for label, child in node.children:
            lines.extend(format_schema(child, indent + 1))
        return lines

    elif h == 20:  # bricknet
        a = node.attrs['advance']
        o = node.attrs['out_offset']
        lines.append(f"{pad}[{node.pos:4d}] bricknet advance={a} out={o}")
        for label, child in node.children:
            lines.extend(format_schema(child, indent + 1))
        return lines

    elif h in (22, 23):  # recurse, recurse16
        t = node.attrs['target']
        lines.append(f"{pad}[{node.pos:4d}] {name} → pos {t}")
        for label, child in node.children:
            lines.extend(format_schema(child, indent + 1))
        return lines

    elif h == 13:  # if_else
        ds = node.attrs['data_skip']
        lines.append(f"{pad}[{node.pos:4d}] if_else data_skip={ds}")
        for label, child in node.children:
            lines.append(f"{pad}  {label}:")
            lines.extend(format_schema(child, indent + 2))
        return lines

    elif h == 12:  # if_then
        lines.append(f"{pad}[{node.pos:4d}] if_then")
        return lines

    elif h == 21:  # cond_skip
        lines.append(f"{pad}[{node.pos:4d}] cond_skip skip={node.attrs['skip']}B")
        return lines

    elif h in DATA_SIZES and h <= 10:
        sz = DATA_SIZES.get(h, 0)
        lines.append(f"{pad}[{node.pos:4d}] {name} ({sz}B)")
        return lines

    elif h == 15 or h == 16:
        lim = node.attrs.get('limit', 0)
        lines.append(f"{pad}[{node.pos:4d}] {name} limit={lim} (8B)")
        return lines

    elif h == 17:
        exp = node.attrs.get('expect', 0)
        lines.append(f"{pad}[{node.pos:4d}] {name} expect={exp}")
        return lines

    elif h == 24:
        tn = node.attrs.get('type_name', '?')
        ds = node.attrs.get('data_size', 0)
        lines.append(f"{pad}[{node.pos:4d}] type_disp type={tn} ({ds}B)")
        return lines

    else:
        lines.append(f"{pad}[{node.pos:4d}] {name}")
        return lines


def calc_static_data_size(node):
    """Calculate static data consumption of a schema node.
    Returns (size, is_static). If is_static is False, the size depends on runtime data.
    """
    h = node.handler
    if h == -2:  # sequence
        total = 0
        for label, child in node.children:
            sz, static = calc_static_data_size(child)
            total += sz
            if not static:
                return total, False
        return total, True

    if h == -1 or h == 11:  # end/NOP
        return 0, True
    if 0 <= h <= 10:
        return DATA_SIZES.get(h, 0), True
    if h == 12:  # if_then — no data consumed by the if_then itself
        return 0, True
    if h == 13:  # if_else — complex, depends on condition
        return 0, False
    if h == 14:  # cnt_loop — data = sum of strides
        return sum(node.attrs['strides']), True
    if h == 15 or h == 16:  # range_chk/sgn
        return 8, True
    if h == 17:  # eq_check
        return 0, False  # unclear
    if h == 18:  # nest_loop
        return node.attrs['stride'] * node.attrs['count'], True
    if h == 19:  # nest_stride — count from data
        return 0, False
    if h == 20:  # bricknet
        return 0, False
    if h == 21:  # cond_skip — 1 byte + conditional skip
        return 0, False
    if h in (22, 23):  # recurse
        if node.children:
            return calc_static_data_size(node.children[0][1])
        return 0, False
    if h == 24:  # type_dispatch
        return node.attrs.get('data_size', 0), True
    return 0, False


class DataParser:
    """Parses actual script data against an opcode schema."""

    def __init__(self, data, offset=0):
        self.data = data
        self.pos = offset
        self.output = []

    def remaining(self):
        return len(self.data) - self.pos

    def read_bytes(self, n):
        result = self.data[self.pos:self.pos + n]
        self.pos += n
        return result

    def read_u8(self):
        v = self.data[self.pos] if self.pos < len(self.data) else 0
        self.pos += 1
        return v

    def read_i8(self):
        v = self.read_u8()
        return v - 256 if v > 127 else v

    def read_u16(self):
        if self.pos + 2 > len(self.data):
            self.pos += 2
            return 0
        v = struct.unpack_from('<H', self.data, self.pos)[0]
        self.pos += 2
        return v

    def read_i16(self):
        if self.pos + 2 > len(self.data):
            self.pos += 2
            return 0
        v = struct.unpack_from('<h', self.data, self.pos)[0]
        self.pos += 2
        return v

    def read_u32(self):
        if self.pos + 4 > len(self.data):
            self.pos += 4
            return 0
        v = struct.unpack_from('<I', self.data, self.pos)[0]
        self.pos += 4
        return v

    def read_i32(self):
        if self.pos + 4 > len(self.data):
            self.pos += 4
            return 0
        v = struct.unpack_from('<i', self.data, self.pos)[0]
        self.pos += 4
        return v

    def read_f32_as_u32(self):
        """Read 4 bytes as u32 (write_typed_float passes raw bits)."""
        return self.read_u32()

    def read_f64(self):
        if self.pos + 8 > len(self.data):
            self.pos += 8
            return 0.0
        v = struct.unpack_from('<d', self.data, self.pos)[0]
        self.pos += 8
        return v

    def parse_node(self, node, indent=0):
        """Parse data according to schema node. Returns list of (indent, text) entries."""
        results = []
        h = node.handler

        if h == -2:  # sequence
            for label, child in node.children:
                results.extend(self.parse_node(child, indent))
            return results

        pad = "  " * indent
        dpos = self.pos

        if h == -1 or h == 11:  # end/NOP
            results.append(f"{pad}NOP")
            return results

        if h == 0:  # cond_exec
            results.append(f"{pad}cond_exec (no data)")
            return results

        if h == 1:  # eval_expr
            v = self.read_u8()
            results.append(f"{pad}eval_expr: {v} (0x{v:02x})  @data[{dpos}]")
            return results

        if h == 2:  # write_u8
            v = self.read_u8()
            results.append(f"{pad}u8: {v} (0x{v:02x})  @data[{dpos}]")
            return results

        if h == 3:  # write_u16
            v = self.read_u16()
            results.append(f"{pad}u16: {v} (0x{v:04x})  @data[{dpos}]")
            return results

        if h == 4:  # write_u32
            v = self.read_u32()
            results.append(f"{pad}u32: 0x{v:08x}  @data[{dpos}]")
            return results

        if h == 5:  # write_f64
            v = self.read_f64()
            results.append(f"{pad}f64: {v}  @data[{dpos}]")
            return results

        if h == 6:  # write_i8
            v = self.read_i8()
            results.append(f"{pad}i8: {v}  @data[{dpos}]")
            return results

        if h == 7:  # write_i16
            v = self.read_i16()
            results.append(f"{pad}i16: {v}  @data[{dpos}]")
            return results

        if h == 8:  # write_i32
            v = self.read_i32()
            results.append(f"{pad}i32: {v}  @data[{dpos}]")
            return results

        if h == 9:  # write_i64
            raw = self.read_bytes(8)
            results.append(f"{pad}i64: {raw.hex()}  @data[{dpos}]")
            return results

        if h == 10:  # write_typed_float
            v = self.read_u32()
            # Interpret as float
            try:
                fv = struct.unpack('<f', struct.pack('<I', v))[0]
            except:
                fv = 0.0
            results.append(f"{pad}typed_f: 0x{v:08x} ({fv:.4f})  @data[{dpos}]")
            return results

        if h == 12:  # if_then — no data in executor 0x4E288
            results.append(f"{pad}if_then")
            return results

        if h == 13:  # if_else
            ds = node.attrs['data_skip']
            results.append(f"{pad}if_else data_skip={ds}")
            # Parse then branch
            if node.children:
                then_start = self.pos
                results.append(f"{pad}  THEN:")
                results.extend(self.parse_node(node.children[0][1], indent + 2))
                # Advance data by data_skip past then
                self.pos = then_start + ds
                results.append(f"{pad}  (skipped to data[{self.pos}])")
            return results

        if h == 14:  # cnt_loop
            count = node.attrs['count']
            strides = node.attrs['strides']
            results.append(f"{pad}cnt_loop count={count} strides={strides}  @data[{dpos}]")
            for i, (label, child, stride) in enumerate(node.children):
                iter_start = self.pos
                results.append(f"{pad}  [{i}] (stride={stride}B, data[{iter_start}]):")
                results.extend(self.parse_node(child, indent + 2))
                # Advance data by stride
                self.pos = iter_start + stride
            return results

        if h == 15:  # range_chk
            v1 = self.read_u32()
            v2 = self.read_u32()
            limit = node.attrs['limit']
            results.append(f"{pad}range_chk limit={limit}: val=0x{v1:08x} max=0x{v2:08x}  @data[{dpos}]")
            return results

        if h == 16:  # range_sgn
            v1 = self.read_u32()
            v2 = self.read_u32()
            limit = node.attrs['limit']
            results.append(f"{pad}range_sgn limit={limit}: val=0x{v1:08x} max=0x{v2:08x}  @data[{dpos}]")
            return results

        if h == 17:  # eq_check
            results.append(f"{pad}eq_check expect={node.attrs['expect']}  @data[{dpos}]")
            return results

        if h == 18:  # nest_loop
            stride = node.attrs['stride']
            count = node.attrs['count']
            results.append(f"{pad}nest_loop stride={stride} count={count}  @data[{dpos}]")
            for i in range(count):
                iter_start = self.pos
                results.append(f"{pad}  [{i}] (data[{iter_start}]):")
                if node.children:
                    results.extend(self.parse_node(node.children[0][1], indent + 2))
                self.pos = iter_start + stride
            return results

        if h == 19:  # nest_stride
            offset_val = node.attrs['offset']
            stride = node.attrs['stride']
            # Count comes from data (u32)
            count = self.read_u32()
            results.append(f"{pad}nest_stride offset={offset_val} stride={stride} count={count}  @data[{dpos}]")
            base = self.pos
            self.pos = base + offset_val  # initial offset
            for i in range(min(count, 100)):  # safety limit
                iter_start = self.pos
                results.append(f"{pad}  [{i}] (data[{iter_start}]):")
                if node.children:
                    results.extend(self.parse_node(node.children[0][1], indent + 2))
                self.pos = iter_start + stride
            return results

        if h == 20:  # bricknet
            a = node.attrs['advance']
            o = node.attrs['out_offset']
            results.append(f"{pad}bricknet advance={a} out={o}  @data[{dpos}]")
            if node.children:
                results.extend(self.parse_node(node.children[0][1], indent + 1))
            return results

        if h == 21:  # cond_skip
            skip = node.attrs['skip']
            cond = self.read_u8()
            results.append(f"{pad}cond_skip cond={cond} skip={skip}B  @data[{dpos}]")
            if cond != 0:
                self.pos += skip
                results.append(f"{pad}  (skipped {skip}B → data[{self.pos}])")
            return results

        if h in (22, 23):  # recurse, recurse16
            target = node.attrs['target']
            results.append(f"{pad}{node.name} → pos {target}  @data[{dpos}]")
            if node.children:
                results.extend(self.parse_node(node.children[0][1], indent + 1))
            return results

        if h == 24:  # type_dispatch
            disc = node.attrs['disc']
            ds = node.attrs.get('data_size', 0)
            raw = self.read_bytes(ds)
            results.append(f"{pad}type_disp type={node.attrs['type_name']}: {raw.hex()}  @data[{dpos}]")
            return results

        results.append(f"{pad}UNKNOWN h={h}  @data[{dpos}]")
        return results


def parse_ppl(buf):
    """Parse PPL header and script directory."""
    if buf[:4] != b'\x7fPPL':
        raise ValueError("Not a PPL file")
    num_presets = struct.unpack_from('<H', buf, 8)[0]
    num_scripts = struct.unpack_from('<H', buf, 10)[0]

    preset_off = 0x10
    dir_off = preset_off + (3 + num_scripts) * 8

    scripts = []
    for i in range(num_scripts):
        ptype = struct.unpack_from('<I', buf, preset_off + (i + 3) * 8)[0]
        param = struct.unpack_from('<I', buf, preset_off + (i + 3) * 8 + 4)[0]
        off = struct.unpack_from('<I', buf, dir_off + i * 8)[0]
        sz = struct.unpack_from('<I', buf, dir_off + i * 8 + 4)[0]
        scripts.append({
            'index': i,
            'type': ptype,
            'param': param,
            'offset': off,
            'size': sz,
            'data': buf[off:off + sz],
        })
    return scripts


TYPE_NAMES = {0x03: "identity", 0x06: "item", 0x09: "npm",
              0x0B: "system", 0x0E: "timer", 0x10: "button"}


def main():
    fw = open(FW_PATH, "rb").read()
    stream = OpcodeStream(fw)

    args = sys.argv[1:]

    if not args or args[0] == "--tree":
        # Show opcode tree for all or specified positions
        positions = [185, 279, 425, 430, 546, 626, 653, 656, 659, 741,
                     963, 1140, 1210, 1229, 1231, 1314, 1329, 1365, 1476, 1584]
        if len(args) > 1:
            positions = [int(x) for x in args[1:]]
        for p in positions:
            print(f"\n{'='*70}")
            print(f"SCHEMA at position {p}")
            print(f"{'='*70}")
            node, end = decode_schema(stream, p)
            for line in format_schema(node):
                print(line)
            sz, static = calc_static_data_size(node)
            print(f"  → data consumption: {sz}B {'(static)' if static else '(dynamic)'}")
            print(f"  → position range: {p} → {end}")

    elif args[0] == "--parse":
        # Parse a specific script from play.bin
        if not os.path.exists(PLAY_PATH):
            print(f"play.bin not found at {PLAY_PATH}")
            sys.exit(1)
        ppl_buf = open(PLAY_PATH, "rb").read()
        scripts = parse_ppl(ppl_buf)

        script_idx = int(args[1]) if len(args) > 1 else 0
        position = int(args[2]) if len(args) > 2 else 1329
        data_offset = int(args[3]) if len(args) > 3 else 12

        s = scripts[script_idx]
        tname = TYPE_NAMES.get(s['type'], f"0x{s['type']:02x}")
        print(f"Script #{s['index']} — {tname} (param={s['param']}, {s['size']}B, "
              f"children={s['data'][10]}, flags=0x{s['data'][11]:02x})")
        print(f"Data hex: {s['data'][data_offset:].hex()}")
        print()

        schema, _ = decode_schema(stream, position)
        parser = DataParser(s['data'], data_offset)
        lines = parser.parse_node(schema)
        for line in lines:
            print(line)
        print(f"\nData consumed: {parser.pos - data_offset} bytes (of {s['size'] - data_offset} available)")

    elif args[0] == "--scan":
        # Try ALL positions against a script and show which ones consume data plausibly
        if not os.path.exists(PLAY_PATH):
            print(f"play.bin not found at {PLAY_PATH}")
            sys.exit(1)
        ppl_buf = open(PLAY_PATH, "rb").read()
        scripts = parse_ppl(ppl_buf)

        script_idx = int(args[1]) if len(args) > 1 else 0
        s = scripts[script_idx]
        tname = TYPE_NAMES.get(s['type'], f"0x{s['type']:02x}")
        print(f"Script #{s['index']} — {tname} (param={s['param']}, {s['size']}B, "
              f"children={s['data'][10]}, flags=0x{s['data'][11]:02x})")
        total_data = s['size'] - 12
        print(f"Data bytes: {total_data}")
        print(f"Data hex: {s['data'][12:].hex()}")
        print()

        positions = [185, 279, 425, 430, 546, 626, 653, 656, 659, 741,
                     963, 1140, 1210, 1229, 1231, 1314, 1329, 1365, 1476, 1584]

        # Try each position at data offset 12
        print("Position scan from data offset 12:")
        for p in positions:
            schema, _ = decode_schema(stream, p)
            sz, static = calc_static_data_size(schema)
            parser = DataParser(s['data'], 12)
            try:
                lines = parser.parse_node(schema)
                consumed = parser.pos - 12
            except:
                consumed = -1
            print(f"  pos={p:5d} ({HANDLER_NAMES.get(stream.handler_at(p),'?'):15s}): "
                  f"static_size={'%3d' % sz if static else 'DYN':>4s}  "
                  f"consumed={consumed:3d}B")

    elif args[0] == "--allscripts":
        # Dump summary of all scripts with their data
        if not os.path.exists(PLAY_PATH):
            print(f"play.bin not found at {PLAY_PATH}")
            sys.exit(1)
        ppl_buf = open(PLAY_PATH, "rb").read()
        scripts = parse_ppl(ppl_buf)

        # For each script, try position 1329 and see how much data it consumes
        schema_1329, _ = decode_schema(stream, 1329)

        for s in scripts:
            tname = TYPE_NAMES.get(s['type'], f"0x{s['type']:02x}")
            children = s['data'][10]
            flags = s['data'][11]
            total_data = s['size'] - 12

            parser = DataParser(s['data'], 12)
            try:
                parser.parse_node(schema_1329)
                consumed_1329 = parser.pos - 12
            except:
                consumed_1329 = -1

            print(f"#{s['index']:2d} {tname:8s} param={s['param']:5d} {s['size']:5d}B "
                  f"ch={children:2d} fl=0x{flags:02x} data={total_data:4d}B "
                  f"pos1329_consumes={consumed_1329:3d}B "
                  f"remaining={total_data - consumed_1329:3d}B "
                  f"first_bytes={s['data'][12:16].hex()}")

    elif args[0] == "--children":
        # Analyze child structure: try to figure out how data is split among children
        # by testing consecutive position applications
        if not os.path.exists(PLAY_PATH):
            sys.exit(1)
        ppl_buf = open(PLAY_PATH, "rb").read()
        scripts = parse_ppl(ppl_buf)

        script_idx = int(args[1]) if len(args) > 1 else 33
        s = scripts[script_idx]
        tname = TYPE_NAMES.get(s['type'], f"0x{s['type']:02x}")
        children = s['data'][10]
        flags = s['data'][11]
        total_data = s['size'] - 12
        print(f"Script #{s['index']} — {tname} (param={s['param']}, {s['size']}B, "
              f"ch={children}, flags=0x{flags:02x})")
        print(f"Data ({total_data}B): {s['data'][12:].hex()}")
        print()

        # Known child handler positions (from RE)
        # For flags=0x00 (8ch): 659, 963, 659, 656, 185, 659, 1210, 1329
        # For flags=0x40 (7ch): ???
        # For flags=0x50 (7ch): ???

        # Let me try different child position sequences
        # From the 10 child handlers:
        child_handlers_8ch_00 = [
            (659, "write_typed_f"),      # 0x67720
            (963, "eval_expr/NOP"),      # 0x6774c
            (659, "write_typed_f"),      # 0x67774
            (656, "nest_loop 3×f"),      # 0x6779c
            (185, "NOP/operand"),        # 0x677d8
            (659, "write_typed_f"),      # 0x67814
            (1210, "write_u16"),         # 0x678c0
            (1329, "cnt_loop main"),     # 0x678f8
        ]

        # Try applying these in sequence
        print("Trying 8ch flags=0x00 sequence:")
        offset = 12
        for i, (pos, desc) in enumerate(child_handlers_8ch_00):
            schema, _ = decode_schema(stream, pos)
            parser = DataParser(s['data'], offset)
            try:
                lines = parser.parse_node(schema)
                consumed = parser.pos - offset
                print(f"  child {i}: pos={pos:5d} ({desc:20s}) → consumed {consumed:3d}B (data[{offset}:{offset+consumed}])")
                for line in lines[:5]:  # first 5 lines
                    print(f"    {line}")
                if len(lines) > 5:
                    print(f"    ... ({len(lines) - 5} more)")
                offset += consumed
            except Exception as e:
                print(f"  child {i}: pos={pos:5d} ({desc:20s}) → ERROR: {e}")
                break
        print(f"  Total consumed: {offset - 12}B of {total_data}B")

        # Also try child sequences for different flag patterns
        # For flags=0x40 (7ch), the first bytes are "11 XX", suggesting cnt_loop
        if flags == 0x40:
            print(f"\nFor flags=0x40 scripts (NPM/system):")
            # These are shorter, simpler scripts
            # The function pointer at [0x80DB54] might point to a different handler set
            # Let me try some sequences
            child_handlers_7ch_40 = [
                (659, "write_typed_f"),
                (963, "eval_expr/NOP"),
                (659, "write_typed_f"),
                (656, "nest_loop 3×f"),
                (185, "NOP/operand"),
                (1210, "write_u16"),
                (1329, "cnt_loop main"),
            ]
            offset = 12
            print("  Trying 7ch sequence (drop child 5):")
            for i, (pos, desc) in enumerate(child_handlers_7ch_40):
                schema, _ = decode_schema(stream, pos)
                parser = DataParser(s['data'], offset)
                try:
                    lines = parser.parse_node(schema)
                    consumed = parser.pos - offset
                    print(f"    child {i}: pos={pos:5d} ({desc:20s}) → consumed {consumed:3d}B")
                    offset += consumed
                except Exception as e:
                    print(f"    child {i}: pos={pos:5d} ({desc:20s}) → ERROR: {e}")
                    break
            print(f"    Total: {offset - 12}B of {total_data}B")

    elif args[0] == "--bruteforce":
        # Brute-force try all permutations of known positions
        # to find what sequence consumes exactly the right amount of data
        if not os.path.exists(PLAY_PATH):
            sys.exit(1)
        ppl_buf = open(PLAY_PATH, "rb").read()
        scripts = parse_ppl(ppl_buf)

        script_idx = int(args[1]) if len(args) > 1 else 33
        s = scripts[script_idx]
        children = s['data'][10]
        flags = s['data'][11]
        total_data = s['size'] - 12
        tname = TYPE_NAMES.get(s['type'], f"0x{s['type']:02x}")
        print(f"Script #{s['index']} — {tname} ch={children} flags=0x{flags:02x} data={total_data}B")

        # Known positions and their static data sizes
        known = []
        for p in [185, 279, 425, 430, 546, 626, 653, 656, 659, 741,
                  963, 1140, 1210, 1229, 1231, 1314, 1329, 1365, 1476, 1584]:
            schema, _ = decode_schema(stream, p)
            sz, static = calc_static_data_size(schema)
            if static:
                known.append((p, sz))

        print(f"Static positions: {[(p,s) for p,s in known]}")
        print()

        # For small scripts, try all combinations
        from itertools import combinations_with_replacement, permutations
        import time

        # Find combinations of `children` positions that sum to `total_data`
        target = total_data
        print(f"Looking for {children} positions summing to {target}...")

        # Get unique sizes
        size_to_positions = {}
        for p, sz in known:
            size_to_positions.setdefault(sz, []).append(p)

        # Use dynamic programming / backtracking
        results = []
        def search(remaining_children, remaining_data, current_combo):
            if remaining_children == 0:
                if remaining_data == 0:
                    results.append(list(current_combo))
                return
            if remaining_data < 0:
                return
            if len(results) >= 100:  # limit
                return
            for p, sz in known:
                if sz <= remaining_data:
                    current_combo.append((p, sz))
                    search(remaining_children - 1, remaining_data - sz, current_combo)
                    current_combo.pop()

        search(children, target, [])
        print(f"Found {len(results)} combinations")
        for combo in results[:20]:
            positions_str = ", ".join(f"{p}({s}B)" for p, s in combo)
            print(f"  [{positions_str}]")

    else:
        print("Usage:")
        print("  python parse-play-engine.py --tree [positions...]")
        print("  python parse-play-engine.py --parse <script_idx> [position] [data_offset]")
        print("  python parse-play-engine.py --scan <script_idx>")
        print("  python parse-play-engine.py --allscripts")
        print("  python parse-play-engine.py --children <script_idx>")
        print("  python parse-play-engine.py --bruteforce <script_idx>")


if __name__ == "__main__":
    main()
