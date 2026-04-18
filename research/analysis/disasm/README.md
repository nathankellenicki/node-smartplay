# Script Disassembly Index

Best-effort bytecode disassembly for all 58 scripts in play.bin.
Uses the 256-byte translation table at firmware offset 0x75CF4.

## Known opcodes (with handler addresses)

| Opcode | Name | Handler | Operand bytes |
|--------|------|---------|---------------|
| 1 | cond_exec | 0x4B8E2 | variable |
| 2 | eval_expr | 0x4B8EC | variable (reads expr operands) |
| 3 | write_byte | 0x4B8F8 | variable |
| 4 | write_half | 0x4B904 | variable |
| 5 | write_word | 0x4B910 | variable |
| 6 | write_float | 0x4B91C | variable |
| 7 | write_typed | 0x4B928 | variable |
| 8 | write_typed2 | 0x4B934 | variable |
| 9 | op9_write? | 0x4B940 | variable |
| 10 | op10_write? | 0x4B94C | variable |
| 11 | op11_write? | 0x4B958 | variable |
| 13 | if_then | 0x4B966 | variable + nested block |
| 14 | if_then_else | 0x4B992 | variable + nested block |
| 15 | counted_loop | 0x4B9E0 | 3 (iterations + range) + nested body |
| 16 | op16 | 0x4BA3A | 2 |
| 17 | op17 | 0x4BA74 | 2 |
| 18 | op18 | 0x4BAB0 | 2 |
| 19 | nested_loop | 0x4BAE6 | 2 + nested body |
| 20 | nested_stride | 0x4BB2A | 3 + nested body |
| 21 | bricknet_send | 0x4BB7A | 2 + nested body |
| 22 | op22 | 0x4B8C2 | 1 |
| 23 | op23 | 0x4BBF0 | 1 (reads byte operand) |
| 24 | op24 | 0x4BBFC | 2 (reads u16 operand) |
| 25 | type_dispatch | 0x4BC1E | 1 (reads type operand) |

## All 58 scripts

| # | Type | Param | Size | File |
|---|------|-------|------|------|
| 0 | id | 1168 | 110 | [script_00.txt](script_00.txt) |
| 1 | id | 256 | 754 | [script_01.txt](script_01.txt) |
| 2 | id | 1152 | 181 | [script_02.txt](script_02.txt) |
| 3 | id | 1024 | 71 | [script_03.txt](script_03.txt) |
| 4 | id | 304 | 381 | [script_04.txt](script_04.txt) |
| 5 | id | 64 | 252 | [script_05.txt](script_05.txt) |
| 6 | id | 1104 | 464 | [script_06.txt](script_06.txt) |
| 7 | id | 432 | 689 | [script_07.txt](script_07.txt) |
| 8 | id | 72 | 760 | [script_08.txt](script_08.txt) |
| 9 | id | 4 | 529 | [script_09.txt](script_09.txt) |
| 10 | id | 384 | 789 | [script_10.txt](script_10.txt) |
| 11 | id | 400 | 679 | [script_11.txt](script_11.txt) |
| 12 | id | 336 | 249 | [script_12.txt](script_12.txt) |
| 13 | id | 272 | 553 | [script_13.txt](script_13.txt) |
| 14 | id | 264 | 702 | [script_14.txt](script_14.txt) |
| 15 | id | 288 | 964 | [script_15.txt](script_15.txt) |
| 16 | item | 1448 | 350 | [script_16.txt](script_16.txt) |
| 17 | item | 68 | 264 | [script_17.txt](script_17.txt) |
| 18 | item | 1192 | 746 | [script_18.txt](script_18.txt) |
| 19 | item | 1296 | 138 | [script_19.txt](script_19.txt) |
| 20 | item | 1128 | 783 | [script_20.txt](script_20.txt) |
| 21 | npm | 384 | 101 | [script_21.txt](script_21.txt) |
| 22 | npm | 448 | 111 | [script_22.txt](script_22.txt) |
| 23 | npm | 336 | 101 | [script_23.txt](script_23.txt) |
| 24 | npm | 400 | 101 | [script_24.txt](script_24.txt) |
| 25 | npm | 288 | 101 | [script_25.txt](script_25.txt) |
| 26 | npm | 272 | 101 | [script_26.txt](script_26.txt) |
| 27 | npm | 320 | 101 | [script_27.txt](script_27.txt) |
| 28 | npm | 416 | 101 | [script_28.txt](script_28.txt) |
| 29 | npm | 480 | 101 | [script_29.txt](script_29.txt) |
| 30 | npm | 352 | 101 | [script_30.txt](script_30.txt) |
| 31 | npm | 256 | 101 | [script_31.txt](script_31.txt) |
| 32 | sys | 64 | 402 | [script_32.txt](script_32.txt) |
| 33 | sys | 96 | 40 | [script_33.txt](script_33.txt) |
| 34 | sys | 80 | 90 | [script_34.txt](script_34.txt) |
| 35 | timer | 266 | 240 | [script_35.txt](script_35.txt) |
| 36 | timer | 82 | 1223 | [script_36.txt](script_36.txt) |
| 37 | timer | 101 | 238 | [script_37.txt](script_37.txt) |
| 38 | timer | 118 | 161 | [script_38.txt](script_38.txt) |
| 39 | timer | 96 | 535 | [script_39.txt](script_39.txt) |
| 40 | timer | 302 | 554 | [script_40.txt](script_40.txt) |
| 41 | timer | 1068 | 242 | [script_41.txt](script_41.txt) |
| 42 | timer | 24 | 1564 | [script_42.txt](script_42.txt) |
| 43 | timer | 1228 | 363 | [script_43.txt](script_43.txt) |
| 44 | timer | 73 | 227 | [script_44.txt](script_44.txt) |
| 45 | timer | 1484 | 330 | [script_45.txt](script_45.txt) |
| 46 | timer | 97 | 98 | [script_46.txt](script_46.txt) |
| 47 | timer | 1868 | 268 | [script_47.txt](script_47.txt) |
| 48 | timer | 1356 | 770 | [script_48.txt](script_48.txt) |
| 49 | timer | 116 | 439 | [script_49.txt](script_49.txt) |
| 50 | timer | 1612 | 634 | [script_50.txt](script_50.txt) |
| 51 | btn | 104 | 233 | [script_51.txt](script_51.txt) |
| 52 | btn | 72 | 103 | [script_52.txt](script_52.txt) |
| 53 | btn | 112 | 69 | [script_53.txt](script_53.txt) |
| 54 | btn | 80 | 551 | [script_54.txt](script_54.txt) |
| 55 | btn | 88 | 159 | [script_55.txt](script_55.txt) |
| 56 | btn | 64 | 501 | [script_56.txt](script_56.txt) |
| 57 | btn | 96 | 239 | [script_57.txt](script_57.txt) |