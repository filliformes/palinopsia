"""Train a texture Neural Cellular Automaton (NCA) on one image, for Palinopsia.

After Niklasson, Mordvintsev, Randazzo & Levin, "Self-Organising Textures"
(Distill, 2021), and the reference PyTorch notebook (Apache-2.0,
google-research/self-organising-systems : texture_nca_pytorch.ipynb).

Every cell of a grid holds 12 numbers (3 are the visible RGB). Each step, each
cell looks at its 3x3 neighbourhood through 4 fixed filters (identity, Sobel x,
Sobel y, Laplacian), feeds those 48 numbers through a tiny network (48 -> 96
ReLU -> 12) and adds the result to itself, on a random half of the cells. The
network's 5,856 weights are learnt so that, starting from an empty (zero) grid,
the pattern that grows has the same local statistics as the target photo (a
sliced optimal-transport loss on VGG16 features). The rule is local and
stochastic, so the texture stays alive and heals when damaged.

Usage (from a venv with torch + torchvision) :
  python train_texture_nca.py TARGET.jpg OUT.bin [--size 128] [--iters 3000]

OUT.bin is 5,856 little-endian float32, laid out for the runtime shader
(src/renderer/src/engine/NcaSource.ts) :
  W1 : 96 hidden x 48 inputs, input i = channel * 4 + filter  (4608)
  B1 : 96                                                      (96)
  W2 : 96 hidden x 12 outputs (column j of the output layer)   (1152)
A preview PNG (the NCA grown on a 256x256 grid) is written next to it.
"""

import argparse
import time

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from torchvision import models

CHN = 12
HIDDEN = 96

ident = torch.tensor([[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 0.0]])
sobel_x = torch.tensor([[-1.0, 0.0, 1.0], [-2.0, 0.0, 2.0], [-1.0, 0.0, 1.0]])
lap = torch.tensor([[1.0, 2.0, 1.0], [2.0, -12.0, 2.0], [1.0, 2.0, 1.0]])


def perception(x, filters):
    b, ch, h, w = x.shape
    y = x.reshape(b * ch, 1, h, w)
    y = F.pad(y, [1, 1, 1, 1], 'circular')
    y = F.conv2d(y, filters[:, None])
    return y.reshape(b, -1, h, w)  # channel-major : c0 (id, sx, sy, lap), c1 ...


class CA(torch.nn.Module):
    def __init__(self, filters):
        super().__init__()
        self.filters = filters
        self.w1 = torch.nn.Conv2d(CHN * 4, HIDDEN, 1)
        self.w2 = torch.nn.Conv2d(HIDDEN, CHN, 1, bias=False)
        with torch.no_grad():
            self.w2.weight.zero_()

    def forward(self, x, update_rate=0.5):
        y = perception(x, self.filters)
        y = self.w2(torch.relu(self.w1(y)))
        b, c, h, w = y.shape
        mask = (torch.rand(b, 1, h, w, device=x.device) + update_rate).floor()
        return x + y * mask


def to_rgb(x):
    return x[:, :3] + 0.5


# ── VGG16 style statistics + sliced optimal transport ────────────────────────
class Styles:
    def __init__(self, device):
        self.vgg = models.vgg16(weights='IMAGENET1K_V1').features.to(device).eval()
        for p in self.vgg.parameters():
            p.requires_grad_(False)
        self.layers = [1, 6, 11, 18, 25]
        self.mean = torch.tensor([0.485, 0.456, 0.406], device=device)[:, None, None]
        self.std = torch.tensor([0.229, 0.224, 0.225], device=device)[:, None, None]

    def __call__(self, imgs):
        x = (imgs - self.mean) / self.std
        b, c, h, w = x.shape
        feats = [x.reshape(b, c, h * w)]
        for i, layer in enumerate(self.vgg[: max(self.layers) + 1]):
            x = layer(x)
            if i in self.layers:
                b, c, h, w = x.shape
                feats.append(x.reshape(b, c, h * w))
        return feats


def project_sort(x, proj):
    return torch.einsum('bcn,cp->bpn', x, proj).sort()[0]


def ot_loss(source, target, proj_n=32):
    ch, n = source.shape[-2:]
    projs = F.normalize(torch.randn(ch, proj_n, device=source.device), dim=0)
    sp = project_sort(source, projs)
    tp = project_sort(target, projs)
    tp = F.interpolate(tp, n, mode='nearest')
    return (sp - tp).square().sum()


def wound(x):
    """Zero a random disc (all channels), like the runtime's DAMAGE trigger."""
    n = x.shape[-1]
    yy, xx = torch.meshgrid(torch.arange(n, device=x.device), torch.arange(n, device=x.device), indexing='ij')
    cx, cy = np.random.randint(n), np.random.randint(n)
    r = n * np.random.uniform(0.08, 0.2)
    dx = torch.minimum((xx - cx).abs(), n - (xx - cx).abs())  # the grid is a torus
    dy = torch.minimum((yy - cy).abs(), n - (yy - cy).abs())
    keep = ((dx * dx + dy * dy) >= r * r).float()
    return x * keep


def load_target(path, size, device):
    img = Image.open(path).convert('RGB').resize((size, size), Image.LANCZOS)
    a = np.asarray(img, dtype=np.float32) / 255.0
    return torch.tensor(a, device=device).permute(2, 0, 1)[None]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('target')
    ap.add_argument('out')
    ap.add_argument('--size', type=int, default=128)
    ap.add_argument('--iters', type=int, default=3000)
    ap.add_argument('--batch', type=int, default=4)
    ap.add_argument('--pool', type=int, default=256)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--no-damage', dest='damage', action='store_false',
                    help='skip the wound-healing training (the runtime DAMAGE trigger cuts a hole)')
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    filters = torch.stack([ident, sobel_x, sobel_x.T, lap]).to(dev)

    styles = Styles(dev)
    target = load_target(args.target, args.size, dev)
    with torch.no_grad():
        target_feats = styles(target)

    ca = CA(filters).to(dev)
    opt = torch.optim.Adam(ca.parameters(), 1e-3)
    sched = torch.optim.lr_scheduler.MultiStepLR(opt, [args.iters // 3, 2 * args.iters // 3], 0.3)
    with torch.no_grad():
        pool = torch.zeros(args.pool, CHN, args.size, args.size, device=dev)

    t0 = time.time()
    for i in range(args.iters):
        with torch.no_grad():
            idx = np.random.choice(args.pool, args.batch, replace=False)
            x = pool[idx]
            if i % 8 == 0:
                x[:1] = 0.0  # keep learning to grow from nothing
            elif args.damage:
                x[1:2] = wound(x[1:2])  # and to heal a hole cut into a grown texture
        for _ in range(np.random.randint(32, 96)):
            x = ca(x)
        feats = styles(to_rgb(x))
        style = sum(ot_loss(a, b.expand(a.shape[0], -1, -1)) for a, b in zip(feats, target_feats))
        overflow = (x - x.clamp(-1.0, 1.0)).abs().sum()
        loss = style + overflow
        opt.zero_grad()
        loss.backward()
        with torch.no_grad():
            for p in ca.parameters():
                p.grad /= p.grad.norm() + 1e-8  # per-tensor gradient normalisation
        opt.step()
        sched.step()
        with torch.no_grad():
            pool[idx] = x.detach()
        if i % 100 == 0 or i == args.iters - 1:
            print(f'{i:5d}  loss {loss.item():10.1f}  overflow {overflow.item():8.2f}  {time.time() - t0:6.0f}s', flush=True)

    # ── Export, laid out for the shader ──
    w1 = ca.w1.weight.detach().cpu().numpy().reshape(HIDDEN, CHN * 4)
    b1 = ca.w1.bias.detach().cpu().numpy().reshape(HIDDEN)
    w2 = ca.w2.weight.detach().cpu().numpy().reshape(CHN, HIDDEN).T.copy()  # (96, 12)
    blob = np.concatenate([w1.ravel(), b1.ravel(), w2.ravel()]).astype('<f4')
    assert blob.size == 5856
    blob.tofile(args.out)
    print('wrote', args.out, blob.nbytes, 'bytes')

    # Preview : grow from zero on a larger grid (the runtime runs on any size).
    with torch.no_grad():
        x = torch.zeros(1, CHN, 256, 256, device=dev)
        for _ in range(600):
            x = ca(x)
        img = (to_rgb(x)[0].permute(1, 2, 0).clamp(0, 1).cpu().numpy() * 255).astype(np.uint8)
        Image.fromarray(img).save(args.out.rsplit('.', 1)[0] + '_preview.png')
        # Heal check : cut a big hole, run on, and compare the style loss before / after.
        before = sum(ot_loss(a, b) for a, b in zip(styles(to_rgb(x)), target_feats)).item()
        n = x.shape[-1]
        yy, xx = torch.meshgrid(torch.arange(n, device=dev), torch.arange(n, device=dev), indexing='ij')
        x = x * (((xx - n / 2) ** 2 + (yy - n / 2) ** 2) >= (n * 0.2) ** 2).float()
        for _ in range(400):
            x = ca(x).clamp(-1.0, 1.0)  # the runtime holds states in [-1, 1]
        after = sum(ot_loss(a, b) for a, b in zip(styles(to_rgb(x)), target_feats)).item()
        print(f'heal check : style loss {before:.1f} grown, {after:.1f} 400 steps after a wound (max |state| {x.abs().max().item():.2f})')
        img = (to_rgb(x)[0].permute(1, 2, 0).clamp(0, 1).cpu().numpy() * 255).astype(np.uint8)
        Image.fromarray(img).save(args.out.rsplit('.', 1)[0] + '_healed.png')


if __name__ == '__main__':
    main()
