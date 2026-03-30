#!/usr/bin/env python3
"""
Enhanced btsnoop parser v3 - Deep analysis of ALL ATT/GATT traffic to identify
the actual services in use, including proprietary ones. Also looks at where
data is actually being written/notified to infer service structure.
"""

import struct
import os
from collections import defaultdict

BTSNOOP_MAGIC = b'btsnoop\x00'
BTSNOOP_HDR_SIZE = 16
RECORD_HDR_SIZE = 24

UUID16_NAMES = {
    0x1800: "Generic Access",
    0x1801: "Generic Attribute",
    0x180A: "Device Information",
    0x180F: "Battery Service",
    0x1623: "LEGO Wireless Protocol (LWP)",
    0x2800: "Primary Service",
    0x2801: "Secondary Service",
    0x2803: "Characteristic Declaration",
    0x2900: "Char Extended Properties",
    0x2901: "Char User Description",
    0x2902: "Client Char Configuration (CCCD)",
    0x2A00: "Device Name",
    0x2A01: "Appearance",
    0x2A04: "Peripheral Preferred Conn Params",
    0x2A05: "Service Changed",
    0x2AA6: "Central Address Resolution",
    0x2B29: "Client Supported Features",
    0x2B2A: "Database Hash",
    0x2B3A: "Server Supported Features",
    0xFEF6: "Wuqi Micro (registered SIG UUID)",
}

ATT_OPCODES = {
    0x01: "Error Response",
    0x02: "Exchange MTU Req",
    0x03: "Exchange MTU Resp",
    0x04: "Find Information Req",
    0x05: "Find Information Resp",
    0x06: "Find By Type Value Req",
    0x07: "Find By Type Value Resp",
    0x08: "Read By Type Req",
    0x09: "Read By Type Resp",
    0x0A: "Read Req",
    0x0B: "Read Resp",
    0x0C: "Read Blob Req",
    0x0D: "Read Blob Resp",
    0x10: "Read By Group Type Req",
    0x11: "Read By Group Type Resp",
    0x12: "Write Req",
    0x13: "Write Resp",
    0x1B: "Handle Value Notification",
    0x1D: "Handle Value Indication",
    0x1E: "Handle Value Confirmation",
    0x52: "Write Command",
}

def uuid128_le_to_str(data):
    b = data[::-1]
    return f"{b[0:4].hex()}-{b[4:6].hex()}-{b[6:8].hex()}-{b[8:10].hex()}-{b[10:16].hex()}"

def uuid16_name(u16):
    return UUID16_NAMES.get(u16, f"Unknown(0x{u16:04X})")

def parse_btsnoop(filepath):
    records = []
    with open(filepath, 'rb') as f:
        header = f.read(BTSNOOP_HDR_SIZE)
        if header[:8] != BTSNOOP_MAGIC:
            return records
        while True:
            rec_hdr = f.read(RECORD_HDR_SIZE)
            if len(rec_hdr) < RECORD_HDR_SIZE:
                break
            orig_len, incl_len, flags, drops, ts = struct.unpack('>IIIIq', rec_hdr)
            data = f.read(incl_len)
            if len(data) < incl_len:
                break
            records.append((flags, data))
    return records

def parse_ad_structures(ad_data):
    structures = []
    i = 0
    while i < len(ad_data):
        length = ad_data[i]; i += 1
        if length == 0 or i + length > len(ad_data): break
        ad_type = ad_data[i]
        ad_value = ad_data[i + 1: i + length]
        structures.append((ad_type, ad_value))
        i += length
    return structures


def analyze_file(filepath):
    print(f"\n{'='*80}")
    print(f"  FILE: {os.path.basename(filepath)}")
    print(f"{'='*80}")

    records = parse_btsnoop(filepath)
    print(f"  Total HCI records: {len(records)}")

    l2cap_reassembly = {}

    # Collectors
    att_traffic = []  # (rec_idx, direction, handle, opcode, opcode_name, data_hex, data_len)
    find_by_type_reqs = []  # (rec_idx, start_h, end_h, attr_type, value)
    find_by_type_resps = []
    read_by_group_type_reqs = []
    read_by_group_type_resps = []
    read_by_type_reqs = []
    read_by_type_resps = []
    find_info_resps = []  # (rec_idx, [(handle, uuid_str)])

    # Active handles - where actual data flows
    write_handles = defaultdict(int)
    notify_handles = defaultdict(int)
    write_data_samples = defaultdict(list)  # handle -> [first few payloads]
    notify_data_samples = defaultdict(list)

    # Advertising
    ad_device_names = {}
    advertised_service_uuids = []  # (addr, uuid_type, uuid_str)

    # Smart Brick addresses
    smart_brick_addrs = set()

    def process_att(att_data, rec_idx, acl_handle, direction):
        if len(att_data) < 1:
            return
        opcode = att_data[0]
        payload = att_data[1:]

        # Find By Type Value Request (0x06)
        if opcode == 0x06 and len(payload) >= 6:
            start_h = struct.unpack('<H', payload[0:2])[0]
            end_h = struct.unpack('<H', payload[2:4])[0]
            attr_type = struct.unpack('<H', payload[4:6])[0]
            value = payload[6:]
            if len(value) == 2:
                val_u16 = struct.unpack('<H', value)[0]
                find_by_type_reqs.append((rec_idx, start_h, end_h, attr_type, f"UUID16 0x{val_u16:04X} ({uuid16_name(val_u16)})", value.hex()))
            elif len(value) == 16:
                find_by_type_reqs.append((rec_idx, start_h, end_h, attr_type, f"UUID128 {uuid128_le_to_str(value)}", value.hex()))
            else:
                find_by_type_reqs.append((rec_idx, start_h, end_h, attr_type, f"raw: {value.hex()}", value.hex()))

        # Find By Type Value Response (0x07)
        elif opcode == 0x07:
            entries = []
            i = 0
            while i + 4 <= len(payload):
                found_h = struct.unpack('<H', payload[i:i+2])[0]
                end_h = struct.unpack('<H', payload[i+2:i+4])[0]
                entries.append((found_h, end_h))
                i += 4
            find_by_type_resps.append((rec_idx, entries))

        # Read By Group Type Request (0x10)
        elif opcode == 0x10 and len(payload) >= 4:
            start_h = struct.unpack('<H', payload[0:2])[0]
            end_h = struct.unpack('<H', payload[2:4])[0]
            uuid_data = payload[4:]
            if len(uuid_data) == 2:
                u16 = struct.unpack('<H', uuid_data)[0]
                read_by_group_type_reqs.append((rec_idx, start_h, end_h, f"0x{u16:04X} ({uuid16_name(u16)})"))
            elif len(uuid_data) == 16:
                read_by_group_type_reqs.append((rec_idx, start_h, end_h, uuid128_le_to_str(uuid_data)))

        # Read By Group Type Response (0x11)
        elif opcode == 0x11 and len(payload) >= 1:
            attr_data_len = payload[0]
            remaining = payload[1:]
            entries = []
            i = 0
            while i + attr_data_len <= len(remaining):
                entry = remaining[i:i+attr_data_len]
                if attr_data_len >= 4:
                    start_h = struct.unpack('<H', entry[0:2])[0]
                    end_h = struct.unpack('<H', entry[2:4])[0]
                    uuid_data = entry[4:]
                    if len(uuid_data) == 2:
                        u16 = struct.unpack('<H', uuid_data)[0]
                        entries.append((start_h, end_h, '16-bit', f"0x{u16:04X}", uuid16_name(u16)))
                    elif len(uuid_data) == 16:
                        entries.append((start_h, end_h, '128-bit', uuid128_le_to_str(uuid_data), ""))
                i += attr_data_len
            read_by_group_type_resps.append((rec_idx, entries))

        # Read By Type Request (0x08)
        elif opcode == 0x08 and len(payload) >= 4:
            start_h = struct.unpack('<H', payload[0:2])[0]
            end_h = struct.unpack('<H', payload[2:4])[0]
            uuid_data = payload[4:]
            if len(uuid_data) == 2:
                u16 = struct.unpack('<H', uuid_data)[0]
                read_by_type_reqs.append((rec_idx, start_h, end_h, f"0x{u16:04X}", uuid16_name(u16)))

        # Read By Type Response (0x09) - characteristics
        elif opcode == 0x09 and len(payload) >= 1:
            attr_data_len = payload[0]
            remaining = payload[1:]
            entries = []
            i = 0
            while i + attr_data_len <= len(remaining):
                entry = remaining[i:i+attr_data_len]
                if attr_data_len >= 5:
                    attr_handle = struct.unpack('<H', entry[0:2])[0]
                    properties = entry[2]
                    value_handle = struct.unpack('<H', entry[3:5])[0]
                    uuid_data = entry[5:]

                    prop_names = []
                    if properties & 0x02: prop_names.append("R")
                    if properties & 0x04: prop_names.append("WnR")
                    if properties & 0x08: prop_names.append("W")
                    if properties & 0x10: prop_names.append("N")
                    if properties & 0x20: prop_names.append("I")

                    if len(uuid_data) == 2:
                        u16 = struct.unpack('<H', uuid_data)[0]
                        entries.append((attr_handle, value_handle, properties, '|'.join(prop_names), '16-bit', f"0x{u16:04X}", uuid16_name(u16)))
                    elif len(uuid_data) == 16:
                        entries.append((attr_handle, value_handle, properties, '|'.join(prop_names), '128-bit', uuid128_le_to_str(uuid_data), ""))
                elif attr_data_len >= 2:
                    # Not a characteristic declaration, could be a value response
                    attr_handle = struct.unpack('<H', entry[0:2])[0]
                    value = entry[2:]
                    entries.append((attr_handle, 0, 0, "", "value", value.hex(), ""))
                i += attr_data_len
            read_by_type_resps.append((rec_idx, entries))

        # Find Information Response (0x05)
        elif opcode == 0x05 and len(payload) >= 1:
            fmt = payload[0]
            remaining = payload[1:]
            entries = []
            if fmt == 0x01:  # 16-bit
                for j in range(0, len(remaining) - 3, 4):
                    h = struct.unpack('<H', remaining[j:j+2])[0]
                    u16 = struct.unpack('<H', remaining[j+2:j+4])[0]
                    entries.append((h, f"0x{u16:04X}", uuid16_name(u16)))
            elif fmt == 0x02:  # 128-bit
                for j in range(0, len(remaining) - 17, 18):
                    h = struct.unpack('<H', remaining[j:j+2])[0]
                    entries.append((h, uuid128_le_to_str(remaining[j+2:j+18]), ""))
            find_info_resps.append((rec_idx, entries))

        # Write Request (0x12) / Write Command (0x52)
        elif opcode in (0x12, 0x52) and len(payload) >= 2:
            handle = struct.unpack('<H', payload[0:2])[0]
            value = payload[2:]
            write_handles[handle] += 1
            if len(write_data_samples[handle]) < 3:
                write_data_samples[handle].append(value.hex())

        # Handle Value Notification (0x1B)
        elif opcode == 0x1B and len(payload) >= 2:
            handle = struct.unpack('<H', payload[0:2])[0]
            value = payload[2:]
            notify_handles[handle] += 1
            if len(notify_data_samples[handle]) < 3:
                notify_data_samples[handle].append(value.hex())

        # Error Response (0x01)
        elif opcode == 0x01 and len(payload) >= 4:
            req_op = payload[0]
            attr_h = struct.unpack('<H', payload[1:3])[0]
            err = payload[3]
            err_names = {0x0A: "Attribute Not Found", 0x05: "Insufficient Auth", 0x06: "Request Not Supported"}
            # Just collect for reference

    # Process records
    for rec_idx, (flags, data) in enumerate(records):
        if len(data) < 1:
            continue
        pkt_type = data[0]
        pkt_data = data[1:]

        # Determine direction from flags
        # flags bit 0: 0=sent, 1=received (from host perspective)
        direction = "recv" if (flags & 0x01) else "sent"

        # HCI Event (0x04)
        if pkt_type == 0x04 and len(pkt_data) >= 2:
            event_code = pkt_data[0]
            params = pkt_data[2:]

            if event_code == 0x3E and len(params) >= 1:
                subevent = params[0]
                if subevent == 0x02 and len(params) >= 2:
                    num_reports = params[1]
                    offset = 2
                    for r in range(num_reports):
                        if offset + 9 > len(params): break
                        evt_type = params[offset]
                        addr_type = params[offset+1]
                        addr = params[offset+2:offset+8]
                        addr_str = ':'.join(f'{b:02X}' for b in reversed(addr))
                        data_len = params[offset+8]
                        offset += 9
                        if offset + data_len > len(params): break
                        ad_data = params[offset:offset+data_len]
                        offset += data_len
                        if offset < len(params): offset += 1

                        ad_structs = parse_ad_structures(ad_data)
                        for ad_type, ad_value in ad_structs:
                            if ad_type in (0x08, 0x09):
                                try:
                                    name = ad_value.decode('utf-8', errors='replace')
                                    ad_device_names[addr_str] = name
                                    if 'Smart Brick' in name:
                                        smart_brick_addrs.add(addr_str)
                                except: pass
                            if ad_type in (0x02, 0x03):
                                for j in range(0, len(ad_value), 2):
                                    if j+2 <= len(ad_value):
                                        u16 = struct.unpack('<H', ad_value[j:j+2])[0]
                                        advertised_service_uuids.append((addr_str, '16-bit', f"0x{u16:04X}", uuid16_name(u16)))
                            elif ad_type in (0x06, 0x07):
                                for j in range(0, len(ad_value), 16):
                                    if j+16 <= len(ad_value):
                                        advertised_service_uuids.append((addr_str, '128-bit', uuid128_le_to_str(ad_value[j:j+16]), ""))
                            # Also check for manufacturer-specific data containing 1623
                            if ad_type == 0xFF and len(ad_value) >= 2:
                                company_id = struct.unpack('<H', ad_value[0:2])[0]
                                mfg_data = ad_value[2:]
                                # Check if 1623 appears in mfg data
                                if b'\x23\x16' in ad_value or b'\x16\x23' in ad_value:
                                    advertised_service_uuids.append((addr_str, 'mfg-data', f"Company 0x{company_id:04X}, contains 1623 bytes", ad_value.hex()))

        # ACL (0x02)
        elif pkt_type == 0x02 and len(pkt_data) >= 4:
            handle_flags_raw = struct.unpack('<H', pkt_data[0:2])[0]
            acl_handle = handle_flags_raw & 0x0FFF
            pb_flag = (handle_flags_raw >> 12) & 0x03
            acl_len = struct.unpack('<H', pkt_data[2:4])[0]
            acl_payload = pkt_data[4:4+acl_len]

            if pb_flag in (0x00, 0x02):
                if len(acl_payload) < 4: continue
                l2cap_len = struct.unpack('<H', acl_payload[0:2])[0]
                l2cap_cid = struct.unpack('<H', acl_payload[2:4])[0]
                l2cap_fragment = acl_payload[4:]

                if len(l2cap_fragment) >= l2cap_len:
                    l2cap_data = l2cap_fragment[:l2cap_len]
                    if l2cap_cid == 0x0004:
                        process_att(l2cap_data, rec_idx, acl_handle, direction)
                    if acl_handle in l2cap_reassembly:
                        del l2cap_reassembly[acl_handle]
                else:
                    l2cap_reassembly[acl_handle] = (l2cap_len, l2cap_cid, bytearray(l2cap_fragment))

            elif pb_flag == 0x01:
                if acl_handle in l2cap_reassembly:
                    expected_len, cid, buf = l2cap_reassembly[acl_handle]
                    buf.extend(acl_payload)
                    if len(buf) >= expected_len:
                        l2cap_data = bytes(buf[:expected_len])
                        if cid == 0x0004:
                            process_att(l2cap_data, rec_idx, acl_handle, direction)
                        del l2cap_reassembly[acl_handle]

    # ==================== RESULTS ====================

    print(f"\n--- SMART BRICK ADDRESSES ---")
    for addr in sorted(smart_brick_addrs):
        print(f"  {addr}")

    print(f"\n--- ADVERTISED SERVICE UUIDs (from Smart Brick addresses) ---")
    seen = set()
    for addr, utype, ustr, name in advertised_service_uuids:
        is_brick = addr in smart_brick_addrs
        key = (addr, ustr)
        if key not in seen:
            seen.add(key)
            marker = " [SMART BRICK]" if is_brick else ""
            lwp = " <<< LWP!" if "1623" in ustr.replace("-","") else ""
            print(f"  {addr}{marker}: [{utype}] {ustr} {name}{lwp}")

    print(f"\n--- ALL ADVERTISED SERVICE UUIDs (unique) ---")
    seen2 = set()
    for _, utype, ustr, name in advertised_service_uuids:
        if ustr not in seen2:
            seen2.add(ustr)
            lwp = " <<< LWP!" if "1623" in ustr.replace("-","") else ""
            print(f"  [{utype}] {ustr} {name}{lwp}")

    print(f"\n--- FIND BY TYPE VALUE REQUESTS (Service Discovery by UUID) ---")
    for rec_idx, start_h, end_h, attr_type, desc, raw in find_by_type_reqs:
        lwp = " <<< LWP SEARCH!" if "1623" in desc or "1623" in raw else ""
        print(f"  rec#{rec_idx:5d}: 0x{start_h:04X}-0x{end_h:04X} AttrType=0x{attr_type:04X} Value={desc}{lwp}")

    print(f"\n--- FIND BY TYPE VALUE RESPONSES ---")
    for rec_idx, entries in find_by_type_resps:
        for found_h, end_h in entries:
            print(f"  rec#{rec_idx:5d}: Found handle 0x{found_h:04X}-0x{end_h:04X}")

    print(f"\n--- READ BY GROUP TYPE REQUESTS ---")
    for rec_idx, start_h, end_h, desc in read_by_group_type_reqs:
        print(f"  rec#{rec_idx:5d}: 0x{start_h:04X}-0x{end_h:04X} {desc}")

    print(f"\n--- READ BY GROUP TYPE RESPONSES (GATT Services) ---")
    for rec_idx, entries in read_by_group_type_resps:
        for start_h, end_h, utype, ustr, name in entries:
            lwp = " <<< LWP!" if "1623" in ustr.replace("-","") else ""
            print(f"  rec#{rec_idx:5d}: 0x{start_h:04X}-0x{end_h:04X} [{utype}] {ustr} {name}{lwp}")

    print(f"\n--- READ BY TYPE REQUESTS (Characteristic Discovery) ---")
    for rec_idx, start_h, end_h, ustr, name in read_by_type_reqs:
        print(f"  rec#{rec_idx:5d}: 0x{start_h:04X}-0x{end_h:04X} {ustr} ({name})")

    print(f"\n--- READ BY TYPE RESPONSES (Characteristics Found) ---")
    for rec_idx, entries in read_by_type_resps:
        for entry in entries:
            if len(entry) == 7:
                attr_h, val_h, props, prop_str, utype, ustr, name = entry
                lwp = ""
                if "1623" in ustr.replace("-",""): lwp = " <<< LWP RELATED!"
                if "1624" in ustr.replace("-",""): lwp = " <<< LWP CHAR!"
                print(f"  rec#{rec_idx:5d}: Attr 0x{attr_h:04X} -> Val 0x{val_h:04X} [{utype}] {ustr} {name} ({prop_str}){lwp}")

    print(f"\n--- FIND INFORMATION RESPONSES (Handle-UUID Mappings) ---")
    for rec_idx, entries in find_info_resps:
        for h, ustr, name in entries:
            lwp = " <<< LWP!" if "1623" in ustr.replace("-","") or "1624" in ustr.replace("-","") else ""
            print(f"  rec#{rec_idx:5d}: Handle 0x{h:04X} = {ustr} {name}{lwp}")

    print(f"\n--- ACTIVE DATA HANDLES: WRITES ---")
    for handle in sorted(write_handles.keys()):
        count = write_handles[handle]
        samples = write_data_samples[handle]
        print(f"  Handle 0x{handle:04X}: {count} writes")
        for s in samples[:2]:
            truncated = s[:80] + "..." if len(s) > 80 else s
            print(f"    Sample: {truncated}")

    print(f"\n--- ACTIVE DATA HANDLES: NOTIFICATIONS ---")
    for handle in sorted(notify_handles.keys()):
        count = notify_handles[handle]
        samples = notify_data_samples[handle]
        print(f"  Handle 0x{handle:04X}: {count} notifications")
        for s in samples[:2]:
            truncated = s[:80] + "..." if len(s) > 80 else s
            print(f"    Sample: {truncated}")

    # Infer service structure from active handles
    print(f"\n--- INFERRED SERVICE STRUCTURE ---")
    all_active_handles = set(write_handles.keys()) | set(notify_handles.keys())
    gatt_handles = set()
    for _, entries in find_by_type_resps:
        for found_h, end_h in entries:
            gatt_handles.add((found_h, end_h))

    for start, end in sorted(gatt_handles):
        active_in_range = [h for h in all_active_handles if start <= h <= end]
        print(f"  Service 0x{start:04X}-0x{end:04X}: Active handles in range: {[f'0x{h:04X}' for h in active_in_range]}")

    orphan_handles = [h for h in all_active_handles if not any(s <= h <= e for s, e in gatt_handles)]
    if orphan_handles:
        print(f"\n  Handles NOT in any discovered service range:")
        for h in sorted(orphan_handles):
            w = write_handles.get(h, 0)
            n = notify_handles.get(h, 0)
            print(f"    0x{h:04X}: {w} writes, {n} notifications")

    # LWP FINAL CHECK
    print(f"\n{'='*80}")
    print(f"  LWP VERDICT")
    print(f"{'='*80}")

    # Check all collected UUIDs
    all_uuid_strs = set()
    for _, _, ustr, _ in advertised_service_uuids:
        all_uuid_strs.add(ustr)
    for _, entries in read_by_group_type_resps:
        for _, _, _, ustr, _ in entries:
            all_uuid_strs.add(ustr)
    for _, entries in read_by_type_resps:
        for entry in entries:
            if len(entry) == 7:
                all_uuid_strs.add(entry[5])
    for _, entries in find_info_resps:
        for _, ustr, _ in entries:
            all_uuid_strs.add(ustr)

    lwp_found = any("1623" in u.replace("-","") for u in all_uuid_strs)
    lwp_char_found = any("1624" in u.replace("-","") for u in all_uuid_strs)

    if lwp_found:
        print(f"  ** LWP Service UUID (1623) FOUND!")
    else:
        print(f"  LWP Service UUID (00001623-1212-efde-1623-785feabcd123) NOT FOUND")
    if lwp_char_found:
        print(f"  ** LWP Characteristic UUID (1624) FOUND!")
    else:
        print(f"  LWP Characteristic UUID (00001624-1212-efde-1623-785feabcd123) NOT FOUND")

    if not lwp_found and not lwp_char_found:
        print(f"\n  The Smart Brick does NOT advertise or use the LWP BLE service.")
        print(f"  The advertised service UUID is 0xFEF6 (a Bluetooth SIG registered UUID).")
        print(f"  Communication uses proprietary handles outside standard GATT service ranges.")


def main():
    base = "/Users/nathankellenicki/Desktop/Projects/openbrickproject/node-smartplay/randomfiles"
    files = [
        os.path.join(base, "android_hci.btsnoop"),
        os.path.join(base, "android_hci_volume.btsnoop"),
    ]

    print("=" * 80)
    print("  LEGO SMART BRICK - LWP BLE SERVICE ANALYSIS v3")
    print(f"  Target: LWP Service  00001623-1212-efde-1623-785feabcd123")
    print(f"  Target: LWP Char     00001624-1212-efde-1623-785feabcd123")
    print("=" * 80)

    for filepath in files:
        if os.path.exists(filepath):
            analyze_file(filepath)
        else:
            print(f"\n  WARNING: File not found: {filepath}")

    print()

if __name__ == '__main__':
    main()
