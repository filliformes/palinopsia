"""Reference NCA step in numpy, bit-compatible with the runtime shader
(src/renderer/src/engine/NcaSource.ts), used to check the GL implementation :
perception orientation, weight layout, torus wrap and the random update mask.

  python reference_step.py WEIGHTS.bin STATE_IN.f32 STATE_OUT.f32 W H SALT

States are float32 arrays of shape (3 textures, H rows, W cols, 4 channels) :
texture t holds channels 4t..4t+3, row 0 = texelFetch row 0.
"""

import sys

import numpy as np


def pcg(v):
    v = v.astype(np.uint64) & 0xFFFFFFFF
    s = (v * 747796405 + 2891336453) & 0xFFFFFFFF
    w = (((s >> ((s >> 28) + 4)) ^ s) * 277803737) & 0xFFFFFFFF
    return ((w >> 22) ^ w) & 0xFFFFFFFF


def step(W, x, salt):
    w1 = W[:4608].reshape(96, 48)
    b1 = W[4608:4704]
    w2 = W[4704:].reshape(96, 12)
    t, h, w, _ = x.shape
    s = np.concatenate([x[0], x[1], x[2]], axis=-1)  # (h, w, 12)
    idn = s
    sx = np.zeros_like(s)
    sy = np.zeros_like(s)
    lp = np.zeros_like(s)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            nb = np.roll(np.roll(s, -dy, axis=0), -dx, axis=1)  # value at (y+dy, x+dx)
            kx = dx * (2.0 if dy == 0 else 1.0)
            ky = dy * (2.0 if dx == 0 else 1.0)
            kl = -12.0 if (dx == 0 and dy == 0) else (2.0 if (dx == 0 or dy == 0) else 1.0)
            sx += kx * nb
            sy += ky * nb
            lp += kl * nb
    perc = np.stack([idn, sx, sy, lp], axis=-1).reshape(h, w, 48)  # channel-major
    hid = np.maximum(perc @ w1.T + b1, 0.0)
    upd = hid @ w2  # (h, w, 12)
    yy, xx = np.mgrid[0:h, 0:w]
    r = pcg((xx.astype(np.uint64) * 73856093 & 0xFFFFFFFF) ^ (yy.astype(np.uint64) * 19349663 & 0xFFFFFFFF) ^ salt)
    m = (r & 1).astype(np.float32)[..., None]
    out = s + upd * m
    return np.stack([out[..., 0:4], out[..., 4:8], out[..., 8:12]], axis=0).astype(np.float32)


if __name__ == '__main__':
    wpath, ipath, opath, W_, H_, salt = sys.argv[1:7]
    W = np.fromfile(wpath, dtype='<f4')
    x = np.fromfile(ipath, dtype='<f4').reshape(3, int(H_), int(W_), 4)
    step(W, x, int(salt)).tofile(opath)
    print('ok')
