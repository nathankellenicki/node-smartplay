/**
 * Grain-128A Verification Tool for LEGO Smart Play Tags
 *
 * This tool tests whether the tag encryption is Grain-128A by:
 *
 * 1. SANITY CHECK: Verify our implementation against known test vectors
 *
 * 2. STRUCTURAL TEST: For each candidate key (we can't brute-force 128 bits,
 *    but we can test specific candidates):
 *    - Generate keystream for each tag's IV
 *    - XOR with ciphertext to get candidate plaintext
 *    - Check if the candidate plaintext has TLV structure:
 *      a) Known type bytes (0x03/0x06) at consistent positions for identity/item
 *      b) Known constants (0x12, 0x0008) at plausible positions
 *      c) Valid content_ref values (6-3200 range)
 *      d) CRC32 or other integrity check at expected position
 *
 * 3. CROSS-TAG CONSISTENCY: If Grain-128A is correct (even with wrong key),
 *    the keystream structure should be deterministic. We can verify the
 *    algorithm by checking if the reference implementation's test vectors match.
 *
 * Usage: ./verify_grain
 */

#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include "grain128a.h"

// Tag data: [name, category, payload_hex]
// payload_hex starts from byte 5 (after cleartext header 00 XX 01 0C 01)
typedef struct {
    const char *name;
    const char *category; // "identity" or "item"
    uint8_t payload[200]; // after 5-byte header
    int payload_len;
} tag_data;

// Parse hex string to bytes
int hex_to_bytes(const char *hex, uint8_t *out) {
    int len = 0;
    while (*hex) {
        while (*hex == ' ') hex++;
        if (!*hex) break;
        unsigned int b;
        sscanf(hex, "%2x", &b);
        out[len++] = (uint8_t)b;
        hex += 2;
    }
    return len;
}

void print_hex(const uint8_t *data, int len) {
    for (int i = 0; i < len; i++) {
        printf("%02x ", data[i]);
        if ((i + 1) % 16 == 0) printf("\n       ");
    }
    printf("\n");
}

int main() {
    printf("=== Grain-128A Verification for LEGO Smart Play Tags ===\n\n");

    // -------------------------------------------------------
    // TEST 1: Verify implementation with known test vector
    // -------------------------------------------------------
    printf("--- Test 1: Reference Implementation Sanity Check ---\n\n");

    // Test vector: key = 0123456789abcdef123456789abcdef0, iv = 0123456789abcdef12345678
    // (from the Noxet reference — non-auth mode, IV bit 0 = 0)
    {
        uint8_t key[] = {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                         0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
        uint8_t iv[]  = {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                         0x00, 0x00, 0x00, 0x00};
        uint8_t ks[16];
        grain128a_keystream(key, iv, ks, 16);
        printf("Key:       all zeros\n");
        printf("IV:        all zeros\n");
        printf("Keystream: ");
        print_hex(ks, 16);
        printf("(Compare with reference implementation output to verify correctness)\n\n");
    }

    // Another test vector with non-zero key/IV
    {
        uint8_t key[] = {0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
                         0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0};
        uint8_t iv[]  = {0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
                         0x12, 0x34, 0x56, 0x78};
        uint8_t ks[16];
        grain128a_keystream(key, iv, ks, 16);
        printf("Key:       0123456789abcdef123456789abcdef0\n");
        printf("IV:        0123456789abcdef12345678 (bit 0 = 0, non-auth)\n");
        printf("Keystream: ");
        print_hex(ks, 16);
    }

    // Same but with IV bit 0 = 1 (auth mode IV)
    {
        uint8_t key[] = {0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
                         0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0};
        uint8_t iv[]  = {0x81, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
                         0x12, 0x34, 0x56, 0x78};
        uint8_t ks[16];
        grain128a_keystream(key, iv, ks, 16);
        printf("Key:       0123456789abcdef123456789abcdef0\n");
        printf("IV:        8123456789abcdef12345678 (bit 0 = 1, auth mode)\n");
        printf("Keystream: ");
        print_hex(ks, 16);
        printf("(Note: in auth mode, keystream gen differs — only every other bit)\n");
        printf("(Our implementation generates non-auth keystream regardless of IV bit 0)\n\n");
    }

    // -------------------------------------------------------
    // TEST 2: Decrypt tags with candidate keys
    // -------------------------------------------------------
    printf("--- Test 2: Decrypt Tags with Candidate Keys ---\n\n");

    // Tags: payload after 5-byte cleartext header (00 LEN 01 0C 01)
    // First 12 bytes = candidate IV, rest = candidate ciphertext
    const char *tag_payloads[] = {
        // R2-D2 (identity, 69 bytes after header)
        "24 b4 10 e7 c0 d0 7d 2d fd b5 13 f9 0d 49 9a 3c b6 45 4f fb 90 bf 80 59 18 c1 85 68 57 0f ce fe 3d d8 60 47 b1 c9 05 2b 16 ae a1 7c 4c 16 b4 af af 94 82 d5 9f a9 41 69 c3 1f f0 f9 eb 13 13 86 13 e2 41 f1 71",
        // X-Wing (item, 102 bytes after header)
        "24 d4 3e 82 9f 37 1f 47 ab 8f 36 36 42 63 71 d5 54 f2 b8 f4 c5 b5 af e9 10 bf 00 83 33 2f 74 f7 ca 47 ef 1a b0 79 86 41 4e ce ca bd 34 f8 da a6 79 c6 47 35 bd 10 31 3c 37 f8 dc db 4a d1 13 bc a3 04 18 02 6c ad eb 41 c9 71 cc ae c1 cd dc 92 79 8e 13 25 97 06 a2 3d 39 e9 d6 f4 1e 33 9b b2 b9 af 46 c2 22 e8",
        // Luke (identity, 152 bytes after header)
        "86 84 cc 84 c0 2c 26 17 c7 f2 2f 6a fb fc 1a ea c1 43 c3 7b f1 0e e8 e4 2d 41 53 42 8f 59 68 1f b1 0b dd 15 83 b5 d7 ff 42 7a 4c 29 ef 2b 2f f7 50 5a d1 11 61 d8 49 e2 65 14 f3 12 13 1f 33 dd bb e1 94 1d b0 e7 15 6a 31 ba 42 c6 12 ba 1e 3f 72 82 4a b7 f2 9e c3 c3 c5 17 47 02 d3 79 13 a5 05 d0 49 52 9f c1 8b 25 49 49 46 ca 0d 0a 8d 2f 53 9b a2 b3 50 2b 7f f4 93 df a6 04 3b 47 4e ae 60 d5 9b 43 d5 d8 38 88 b2 61 78 c1 c6 83 1f f2 03 0e 10 57 2c 85 95 29",
        NULL
    };
    const char *tag_names[] = {"R2-D2", "X-Wing", "Luke", NULL};
    const char *tag_cats[] = {"identity", "item", "identity", NULL};
    int tag_payload_lens[] = {69, 102, 152};

    // Candidate keys to try (we can't brute-force, but test obvious ones)
    uint8_t candidate_keys[][16] = {
        {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
        {0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff},
        {0x4c,0x45,0x47,0x4f,0x4c,0x45,0x47,0x4f,0x4c,0x45,0x47,0x4f,0x4c,0x45,0x47,0x4f}, // "LEGOLEGOLEGOLEGO"
        {0x50,0x31,0x31,0x5f,0x61,0x75,0x64,0x69,0x6f,0x62,0x72,0x69,0x63,0x6b,0x00,0x00}, // "P11_audiobrick\0\0"
    };
    const char *key_names[] = {"all-zeros", "all-FF", "LEGOLEGOLEGOLEGO", "P11_audiobrick"};
    int num_keys = 4;

    for (int k = 0; k < num_keys; k++) {
        printf("=== Key: %s ===\n", key_names[k]);
        printf("    ");
        print_hex(candidate_keys[k], 16);

        for (int t = 0; tag_payloads[t]; t++) {
            uint8_t payload[200];
            int plen = hex_to_bytes(tag_payloads[t], payload);

            // First 12 bytes = IV
            uint8_t *iv = payload;
            uint8_t *ct = payload + 12;
            int ct_len = plen - 12;

            // Generate keystream
            uint8_t ks[200];
            grain128a_keystream(candidate_keys[k], iv, ks, ct_len);

            // Decrypt: plaintext = ciphertext XOR keystream
            uint8_t pt[200];
            for (int i = 0; i < ct_len; i++) pt[i] = ct[i] ^ ks[i];

            printf("\n  %s (%s, %d ct bytes):\n", tag_names[t], tag_cats[t], ct_len);
            printf("  IV:  ");
            print_hex(iv, 12);
            printf("  PT:  ");
            print_hex(pt, ct_len > 48 ? 48 : ct_len);

            // Check for TLV structure indicators
            // Look for type_byte 0x03 (identity) or 0x06 (item) anywhere in first 20 bytes
            int found_type = 0;
            for (int i = 0; i < 20 && i < ct_len; i++) {
                if ((strcmp(tag_cats[t], "identity") == 0 && pt[i] == 0x03) ||
                    (strcmp(tag_cats[t], "item") == 0 && pt[i] == 0x06)) {
                    printf("  ** type_byte 0x%02x found at plaintext offset %d\n", pt[i], i);
                    found_type++;
                }
            }

            // Look for resource ref constants: tag_byte 0x12, sub_type 0x08 0x00
            for (int i = 0; i < ct_len - 2; i++) {
                if (pt[i] == 0x12 && pt[i+2] == 0x08 && pt[i+3] == 0x00) {
                    printf("  ** resource ref pattern [12 ?? 08 00] at plaintext offset %d\n", i);
                }
            }

            // Look for TLV type 0x22 header (22 00)
            for (int i = 0; i < ct_len - 1; i++) {
                if (pt[i] == 0x22 && pt[i+1] == 0x00) {
                    printf("  ** TLV type 0x22 header at plaintext offset %d\n", i);
                }
            }

            // Check if values in u16 LE at various positions fall in content_ref range (6-3200)
            int valid_u16_count = 0;
            for (int i = 10; i < ct_len - 1; i += 2) {
                uint16_t val = pt[i] | (pt[i+1] << 8);
                if (val >= 6 && val <= 3200) valid_u16_count++;
            }
            printf("  u16 LE values in content_ref range (6-3200): %d/%d positions\n",
                   valid_u16_count, (ct_len - 10) / 2);
        }
        printf("\n");
    }

    // -------------------------------------------------------
    // TEST 3: Cross-tag keystream consistency check
    // -------------------------------------------------------
    printf("--- Test 3: Cross-Tag Structural Consistency ---\n\n");
    printf("For each candidate key, check if type_byte appears at the SAME\n");
    printf("offset across all identity tags (should be 0x03) and all item\n");
    printf("tags (should be 0x06). A consistent offset = strong signal.\n\n");

    // Use all-zeros key as example
    uint8_t test_key[16] = {0};

    // Process all tags
    const char *all_payloads[] = {
        "24 b4 10 e7 c0 d0 7d 2d fd b5 13 f9 0d 49 9a 3c b6 45 4f fb 90 bf 80 59 18 c1 85 68 57 0f ce fe 3d d8 60 47 b1 c9 05 2b 16 ae a1 7c 4c 16 b4 af af 94 82 d5 9f a9 41 69 c3 1f f0 f9 eb 13 13 86 13 e2 41 f1 71", // R2D2
        "60 13 a1 b6 61 b9 46 bb 7d 02 e4 31 dd 63 f7 45 e4 c5 a6 5a 3b b5 e4 d0 36 5f 4d 81 5d 05 b1 d2 08 3e fb 0d ab 2f 32 e9 a0 3b 90 b4 a3 71 c8 61 56 e2 94 30 ac 1a 80 35 5d b8 11 7f 24 cb 9d c2 d2 fa cc 19 4f 4c 1d e6 2a 80 d9 ba 9e 90 bf d8 71 20 bf a1 83 c6 98 ad 9a 29 89 04 68 8b cf 2c 8c 38 2c 20 ca 61 3b 0a 8a 96 85 3e", // Han
        "86 84 cc 84 c0 2c 26 17 c7 f2 2f 6a fb fc 1a ea c1 43 c3 7b f1 0e e8 e4 2d 41 53 42 8f 59 68 1f b1 0b dd 15 83 b5 d7 ff 42 7a 4c 29 ef 2b 2f f7 50 5a d1 11 61 d8 49 e2 65 14 f3 12 13 1f 33 dd bb e1 94 1d b0 e7 15 6a 31 ba 42 c6 12 ba 1e 3f 72 82 4a b7 f2 9e c3 c3 c5 17 47 02 d3 79 13 a5 05 d0 49 52 9f c1 8b 25 49 49 46 ca 0d 0a 8d 2f 53 9b a2 b3 50 2b 7f f4 93 df a6 04 3b 47 4e ae 60 d5 9b 43 d5 d8 38 88 b2 61 78 c1 c6 83 1f f2 03 0e 10 57 2c 85 95 29", // Luke
        "24 d4 3e 82 9f 37 1f 47 ab 8f 36 36 42 63 71 d5 54 f2 b8 f4 c5 b5 af e9 10 bf 00 83 33 2f 74 f7 ca 47 ef 1a b0 79 86 41 4e ce ca bd 34 f8 da a6 79 c6 47 35 bd 10 31 3c 37 f8 dc db 4a d1 13 bc a3 04 18 02 6c ad eb 41 c9 71 cc ae c1 cd dc 92 79 8e 13 25 97 06 a2 3d 39 e9 d6 f4 1e 33 9b b2 b9 af 46 c2 22 e8", // XWing
        "6d bc b0 50 6c da ed cf d2 a4 62 54 05 a4 8d 51 59 fb ca 70 6f 56 ff c1 d1 fd 22 bd 52 c8 71 1a 0b 55 11 3e 04 81 2b 9c d2 dd b0 0d c0 d9 f2 5b d5 1b bb d9 7a 0a 2a ba 97 2f 9e 8c b7 25 da 9d 6b 10 82 3d 2b ef 36 de 8e 71 32 f8 e2 cf 9f 25 71 78 86 ec 48 30 2c ee 55 a9 d3 17 80 93 e1 51 72 59 f3 10 eb 6a 8c 44 b2 93 c5 96 9f f1 9a 54 1f d3 87 58 91 0d f4 01 94", // Lightsaber
        NULL
    };
    const char *all_names[] = {"R2-D2", "Han Solo", "Luke", "X-Wing", "Lightsaber", NULL};
    const char *all_cats[] = {"identity", "identity", "identity", "item", "item", NULL};

    // For each byte position in decrypted plaintext, check if it's consistently
    // 0x03 for identity and 0x06 for item
    printf("Checking first 30 plaintext bytes for type_byte consistency (key=all-zeros):\n\n");
    printf("pos | id_vals(R2D2,Han,Luke)  | item_vals(XWing,Saber) | id=03? item=06? cross=05?\n");
    printf("----+-------------------------+------------------------+-------------------------\n");

    for (int pos = 0; pos < 30; pos++) {
        uint8_t id_vals[3], item_vals[2];
        int id_count = 0, item_count = 0;

        for (int t = 0; all_payloads[t]; t++) {
            uint8_t payload[200];
            int plen = hex_to_bytes(all_payloads[t], payload);
            if (plen < 12 + pos + 1) continue;

            uint8_t ks[200];
            grain128a_keystream(test_key, payload, ks, plen - 12);
            uint8_t pt_byte = payload[12 + pos] ^ ks[pos];

            if (strcmp(all_cats[t], "identity") == 0) {
                id_vals[id_count++] = pt_byte;
            } else {
                item_vals[item_count++] = pt_byte;
            }
        }

        int id_all_03 = 1, item_all_06 = 1;
        for (int i = 0; i < id_count; i++) if (id_vals[i] != 0x03) id_all_03 = 0;
        for (int i = 0; i < item_count; i++) if (item_vals[i] != 0x06) item_all_06 = 0;

        // Check cross-type XOR = 0x05
        int cross_05 = (id_count > 0 && item_count > 0) ? ((id_vals[0] ^ item_vals[0]) == 0x05) : 0;

        char id_str[64] = "", item_str[64] = "";
        for (int i = 0; i < id_count; i++) sprintf(id_str + strlen(id_str), "%02x ", id_vals[i]);
        for (int i = 0; i < item_count; i++) sprintf(item_str + strlen(item_str), "%02x ", item_vals[i]);

        printf(" %2d | %-23s | %-22s | %s %s %s",
               pos, id_str, item_str,
               id_all_03 ? "YES" : "no ",
               item_all_06 ? "YES" : "no ",
               cross_05 ? "YES <<<" : "no");
        if (id_all_03 && item_all_06) printf("  *** MATCH ***");
        printf("\n");
    }

    printf("\nDone.\n");
    return 0;
}
