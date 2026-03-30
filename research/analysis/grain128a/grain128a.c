#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include "grain128a.h"

static uint8_t init_rounds = 0;

void init_grain(grain_state *grain, uint8_t *key, uint8_t *iv)
{
    for (int i = 0; i < 12; i++) {
        for (int j = 0; j < 8; j++) {
            grain->lfsr[8 * i + j] = (iv[i] & (1 << (7-j))) >> (7-j);
        }
    }
    for (int i = 96; i < 127; i++) {
        grain->lfsr[i] = 1;
    }
    grain->lfsr[127] = 0;

    for (int i = 0; i < 16; i++) {
        for (int j = 0; j < 8; j++) {
            grain->nfsr[8 * i + j] = (key[i] & (1 << (7-j))) >> (7-j);
        }
    }

    memset(grain->auth_acc, 0, 32);
    memset(grain->auth_sr, 0, 32);
}

uint8_t next_lfsr_fb(grain_state *grain)
{
    return grain->lfsr[96] ^ grain->lfsr[81] ^ grain->lfsr[70] ^
           grain->lfsr[38] ^ grain->lfsr[7] ^ grain->lfsr[0];
}

uint8_t next_nfsr_fb(grain_state *grain)
{
    return grain->nfsr[96] ^ grain->nfsr[91] ^ grain->nfsr[56] ^ grain->nfsr[26] ^ grain->nfsr[0] ^
           (grain->nfsr[84] & grain->nfsr[68]) ^
           (grain->nfsr[67] & grain->nfsr[3]) ^
           (grain->nfsr[65] & grain->nfsr[61]) ^
           (grain->nfsr[59] & grain->nfsr[27]) ^
           (grain->nfsr[48] & grain->nfsr[40]) ^
           (grain->nfsr[18] & grain->nfsr[17]) ^
           (grain->nfsr[13] & grain->nfsr[11]) ^
           (grain->nfsr[82] & grain->nfsr[78] & grain->nfsr[70]) ^
           (grain->nfsr[25] & grain->nfsr[24] & grain->nfsr[22]) ^
           (grain->nfsr[95] & grain->nfsr[93] & grain->nfsr[92] & grain->nfsr[88]);
}

uint8_t next_h(grain_state *grain)
{
    #define x0 grain->nfsr[12]
    #define x1 grain->lfsr[8]
    #define x2 grain->lfsr[13]
    #define x3 grain->lfsr[20]
    #define x4 grain->nfsr[95]
    #define x5 grain->lfsr[42]
    #define x6 grain->lfsr[60]
    #define x7 grain->lfsr[79]
    #define x8 grain->lfsr[94]
    return (x0 & x1) ^ (x2 & x3) ^ (x4 & x5) ^ (x6 & x7) ^ (x0 & x4 & x8);
}

uint8_t shift(uint8_t fsr[128], uint8_t fb)
{
    uint8_t out = fsr[0];
    for (int i = 0; i < 127; i++) fsr[i] = fsr[i+1];
    fsr[127] = fb;
    return out;
}

uint8_t next_z(grain_state *grain)
{
    uint8_t lfsr_fb = next_lfsr_fb(grain);
    uint8_t nfsr_fb = next_nfsr_fb(grain);
    uint8_t h_out = next_h(grain);

    uint8_t A[] = {2, 15, 36, 45, 64, 73, 89};
    uint8_t nfsr_tmp = 0;
    for (int i = 0; i < 7; i++) nfsr_tmp ^= grain->nfsr[A[i]];

    uint8_t y = h_out ^ grain->lfsr[93] ^ nfsr_tmp;

    uint8_t lfsr_out;
    if (init_rounds) {
        lfsr_out = shift(grain->lfsr, lfsr_fb ^ y);
        shift(grain->nfsr, nfsr_fb ^ lfsr_out ^ y);
    } else {
        lfsr_out = shift(grain->lfsr, lfsr_fb);
        shift(grain->nfsr, nfsr_fb ^ lfsr_out);
    }
    return y;
}

void grain128a_keystream(uint8_t *key, uint8_t *iv, uint8_t *out, int len)
{
    grain_state grain;
    init_grain(&grain, key, iv);

    // 256 initialization rounds
    init_rounds = 1;
    for (int i = 0; i < 256; i++) next_z(&grain);
    init_rounds = 0;

    // Generate keystream bytes (non-auth mode: every bit is keystream)
    for (int i = 0; i < len; i++) {
        uint8_t byte = 0;
        for (int j = 0; j < 8; j++) {
            byte = (byte << 1) | next_z(&grain);
        }
        out[i] = byte;
    }
}
