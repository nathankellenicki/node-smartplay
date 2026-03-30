#ifndef GRAIN128A_H
#define GRAIN128A_H

#include <stdint.h>

#define STREAM_BYTES 256

typedef struct {
    uint8_t lfsr[128];
    uint8_t nfsr[128];
    uint8_t auth_acc[32];
    uint8_t auth_sr[32];
} grain_state;

void init_grain(grain_state *grain, uint8_t *key, uint8_t *iv);
uint8_t next_lfsr_fb(grain_state *grain);
uint8_t next_nfsr_fb(grain_state *grain);
uint8_t next_h(grain_state *grain);
uint8_t shift(uint8_t fsr[128], uint8_t fb);
uint8_t next_z(grain_state *grain);

// Generate keystream bytes (non-authenticated mode)
void grain128a_keystream(uint8_t *key, uint8_t *iv, uint8_t *out, int len);

#endif
