// Palinopsia Spout sender AND receiver : a minimal N-API addon over Spout2's
// spoutDX (DX11) class. Vendored Spout SDK : leadedge/Spout2 (BSD-2-Clause).
//
// SENDER : the app publishes its composite as a Spout source (Resolume, OBS,
// etc.) directly from the readback pixels. DX11 needs no OpenGL context, so it
// runs headless wherever it is loaded (the main window's preload).
//
// RECEIVER (the "Spout / Syphon Input" layer source) : each receiver runs on a
// thread of its own, with a D3D11 device of its own, so nothing it does (the
// SDK sleeps 67 ms whenever a sender closes or changes size) ever reaches the
// page's thread. Two ways out to the page :
//   GPU : each new frame is copied, GPU to GPU, into one of four textures this
//         addon shares with an NT handle; the page imports those once (Electron's
//         sharedTexture) and reads them as VideoFrames : no pixel ever crosses
//         the CPU. Needs the sender on the graphics card the app draws with.
//   CPU : the frame is read back through two staging textures into memory and
//         copied, off the page's thread, into the page's own buffers (the NDI
//         input's route). Any graphics card, 8-bit formats.
// A sender that closes, restarts or changes size is picked up again by name.

#include <napi.h>
#include <atomic>
#include <chrono>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>
#include <dxgi1_6.h>
#include <d3d11_1.h>
#include "sdk/SpoutDX.h"

// ─── Sender ─────────────────────────────────────────────────────────────────

static spoutDX* g_sender = nullptr;
static std::vector<unsigned char> g_flip;

// open(name[, format, adapter]) → bool. Creates the DX11 sender. `format` (a
// DXGI number, default RGBA8) and `adapter` (an index in adapters()) are for
// test senders : the app sends RGBA8 on the default card.
Napi::Value Open(const Napi::CallbackInfo& info) {
  std::string name = info[0].As<Napi::String>().Utf8Value();
  DXGI_FORMAT fmt = DXGI_FORMAT_R8G8B8A8_UNORM;
  if (info.Length() > 1 && info[1].IsNumber()) fmt = (DXGI_FORMAT)info[1].As<Napi::Number>().Uint32Value();
  if (!g_sender) {
    g_sender = new spoutDX();
    if (info.Length() > 2 && info[2].IsNumber()) g_sender->SetAdapter(info[2].As<Napi::Number>().Int32Value());
  }
  bool ok = g_sender->OpenDirectX11();
  if (ok) {
    // Match our RGBA8 readback so channels aren't swapped.
    g_sender->SetSenderFormat(fmt);
    g_sender->SetSenderName(name.c_str());
  }
  return Napi::Boolean::New(info.Env(), ok);
}

// send(buffer, width, height[, topDown]). Buffer is RGBA8, GL bottom-up → flipped
// here; topDown = already top-down (the GPU flipped it) : sent as is, which skips
// a whole-frame copy (33 MB at 4K, several ms on the calling thread).
Napi::Value Send(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_sender) return env.Undefined();
  Napi::Buffer<unsigned char> buf = info[0].As<Napi::Buffer<unsigned char>>();
  uint32_t w = info[1].As<Napi::Number>().Uint32Value();
  uint32_t h = info[2].As<Napi::Number>().Uint32Value();
  const bool topDown = info.Length() > 3 && info[3].IsBoolean() && info[3].As<Napi::Boolean>().Value();
  const size_t stride = (size_t)w * 4;
  if (buf.Length() < stride * h) return env.Undefined();
  const unsigned char* src = buf.Data();
  if (topDown) {
    g_sender->SendImage(src, w, h);
    return env.Undefined();
  }
  if (g_flip.size() != stride * h) g_flip.resize(stride * h);
  for (uint32_t y = 0; y < h; ++y)
    memcpy(&g_flip[y * stride], src + (size_t)(h - 1 - y) * stride, stride);
  g_sender->SendImage(g_flip.data(), w, h);
  return env.Undefined();
}

// close(). Releases the sender.
Napi::Value Close(const Napi::CallbackInfo& info) {
  if (g_sender) {
    g_sender->ReleaseSender();
    delete g_sender;
    g_sender = nullptr;
  }
  return info.Env().Undefined();
}

// ─── Receiver ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// The DXGI formats a receiver can pass on, and how. GPU : the shared texture's
// format family (CopyResource stays within one) and Electron's name for it.
// CPU : 8-bit only, BGRA swapped to RGBA on the way.
struct FormatWay {
  DXGI_FORMAT ring = DXGI_FORMAT_UNKNOWN; // GPU copy target, UNKNOWN = not on the GPU route
  const char* pixel = "";                 // Electron's pixelFormat
  bool cpu = false;                       // readable on the CPU route
  bool swap = false;                      // CPU : BGRA → RGBA
};

static FormatWay WayFor(DWORD f) {
  FormatWay w;
  switch (f) {
    case DXGI_FORMAT_R8G8B8A8_TYPELESS:
    case DXGI_FORMAT_R8G8B8A8_UNORM:
    case DXGI_FORMAT_R8G8B8A8_UNORM_SRGB:
      w.ring = DXGI_FORMAT_R8G8B8A8_UNORM; w.pixel = "rgba"; w.cpu = true; break;
    case DXGI_FORMAT_B8G8R8A8_TYPELESS:
    case DXGI_FORMAT_B8G8R8A8_UNORM:
    case DXGI_FORMAT_B8G8R8A8_UNORM_SRGB:
      w.ring = DXGI_FORMAT_B8G8R8A8_UNORM; w.pixel = "bgra"; w.cpu = true; w.swap = true; break;
    case DXGI_FORMAT_B8G8R8X8_UNORM:
    case DXGI_FORMAT_B8G8R8X8_TYPELESS:
    case DXGI_FORMAT_B8G8R8X8_UNORM_SRGB:
      w.cpu = true; w.swap = true; break; // no BGRX in Electron's list : CPU only
    case DXGI_FORMAT_R16G16B16A16_TYPELESS:
    case DXGI_FORMAT_R16G16B16A16_FLOAT:
      w.ring = DXGI_FORMAT_R16G16B16A16_FLOAT; w.pixel = "rgbaf16"; break;
    default: break;
  }
  return w;
}

// The graphics card Chromium draws with : the app asks for the high-performance
// one (force_high_performance_gpu), so the shared textures are made there.
static ID3D11Device* MakeDevice() {
  IDXGIFactory1* f1 = nullptr;
  IDXGIAdapter1* adapter = nullptr;
  if (SUCCEEDED(CreateDXGIFactory1(__uuidof(IDXGIFactory1), (void**)&f1)) && f1) {
    IDXGIFactory6* f6 = nullptr;
    if (SUCCEEDED(f1->QueryInterface(__uuidof(IDXGIFactory6), (void**)&f6)) && f6) {
      f6->EnumAdapterByGpuPreference(0, DXGI_GPU_PREFERENCE_HIGH_PERFORMANCE, __uuidof(IDXGIAdapter1), (void**)&adapter);
      f6->Release();
    }
    if (!adapter) f1->EnumAdapters1(0, &adapter);
    f1->Release();
  }
  const D3D_FEATURE_LEVEL levels[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0 };
  ID3D11Device* dev = nullptr;
  ID3D11DeviceContext* ctx = nullptr;
  HRESULT hr = D3D11CreateDevice(adapter, adapter ? D3D_DRIVER_TYPE_UNKNOWN : D3D_DRIVER_TYPE_HARDWARE, nullptr,
                                 D3D11_CREATE_DEVICE_BGRA_SUPPORT, levels, 2, D3D11_SDK_VERSION, &dev, nullptr, &ctx);
  if (FAILED(hr)) {
    hr = D3D11CreateDevice(adapter, adapter ? D3D_DRIVER_TYPE_UNKNOWN : D3D_DRIVER_TYPE_HARDWARE, nullptr,
                           D3D11_CREATE_DEVICE_BGRA_SUPPORT, levels + 1, 1, D3D11_SDK_VERSION, &dev, nullptr, &ctx);
  }
  if (adapter) adapter->Release();
  if (ctx) ctx->Release(); // the device keeps its immediate context
  return SUCCEEDED(hr) ? dev : nullptr;
}

static const int RING = 4;

struct Slot {
  ID3D11Texture2D* tex = nullptr;
  HANDLE nt = nullptr;
};

// One generation of shared textures (one sender size / format). Kept alive
// until the page says it let go of its imports (retire), so a resize never
// pulls a texture out from under a frame still being drawn.
struct Ring {
  int gen = 0;
  unsigned w = 0, h = 0;
  std::string pixel;
  Slot slot[RING];
  void Free() {
    for (auto& s : slot) {
      if (s.nt) CloseHandle(s.nt);
      if (s.tex) s.tex->Release();
      s = Slot{};
    }
  }
};

enum class RxState { Waiting, Live, Unsupported, OtherGpu, Failed };

static const char* StateName(RxState s) {
  switch (s) {
    case RxState::Waiting: return "waiting";
    case RxState::Live: return "live";
    case RxState::Unsupported: return "unsupported";
    case RxState::OtherGpu: return "other-gpu";
    default: return "failed";
  }
}

struct SpoutRx {
  std::string name;
  bool gpu = true;
  std::atomic<bool> stop{ false };
  std::thread th;
  std::mutex mx; // guards everything below

  RxState state = RxState::Waiting;
  unsigned w = 0, h = 0;
  DWORD format = 0;
  double fps = 0;
  long senderFrame = 0;
  std::string error;
  // GPU route
  std::vector<std::unique_ptr<Ring>> rings; // the current one last; older ones until retired
  int gen = 0;
  int published = -1; // slot holding the newest frame
  int taken = -1, takenBefore = -1; // the slots the page read last (never written)
  uint64_t seq = 0;
  uint64_t takenSeq = 0;
  double stampMs = 0; // when the newest frame was ready (ms since the epoch)
  // CPU route : the newest frame (front) and the one being filled (back)
  std::vector<unsigned char> front, back;
  unsigned fw = 0, fh = 0;

  Ring* Current() { return rings.empty() ? nullptr : rings.back().get(); }
};

static std::mutex g_rxMx;
static std::map<int, std::shared_ptr<SpoutRx>> g_rx;
static int g_nextRx = 1;

static double NowMs() {
  using namespace std::chrono;
  return (double)duration_cast<microseconds>(system_clock::now().time_since_epoch()).count() / 1000.0;
}

// A short, precise wait : a high-resolution waitable timer (1 ms means 1 ms,
// not the 15.6 ms of a plain Sleep(1) when nobody raised the timer rate).
struct Ticker {
  HANDLE t = nullptr;
  Ticker() { t = CreateWaitableTimerExW(nullptr, nullptr, 0x00000002 /* CREATE_WAITABLE_TIMER_HIGH_RESOLUTION */, TIMER_ALL_ACCESS); }
  ~Ticker() { if (t) CloseHandle(t); }
  void Wait(double ms) {
    if (!t) { Sleep((DWORD)(ms < 1 ? 1 : ms)); return; }
    LARGE_INTEGER due;
    due.QuadPart = -(LONGLONG)(ms * 10000.0);
    if (SetWaitableTimer(t, &due, 0, nullptr, nullptr, FALSE)) WaitForSingleObject(t, 100);
    else Sleep(1);
  }
};

// Polls every millisecond only near the time the next frame is due : right
// after a frame it sleeps 60 % of the sender's usual interval. Measured : a 1 kHz
// poll cost 8 % of a core for one 60 fps sender; this keeps the same latency.
struct Pacer {
  double ema = 0, last = 0;
  bool fresh = false;
  static double Ms() {
    using namespace std::chrono;
    return duration_cast<duration<double, std::milli>>(steady_clock::now().time_since_epoch()).count();
  }
  double Next(bool counted) {
    if (!counted) return 8.0; // no frame counter : every look is "new", copy at most ~120 a second
    const bool f = fresh;
    fresh = false;
    return f && ema > 4 ? (ema * 0.6 < 40 ? ema * 0.6 : 40) : 1.0;
  }
  void Got() {
    const double now = Ms();
    if (last > 0 && now - last < 250) ema = ema > 0 ? ema * 0.8 + (now - last) * 0.2 : now - last;
    last = now;
    fresh = true;
  }
};

static bool MakeRing(ID3D11Device* dev, Ring& r, unsigned w, unsigned h, DXGI_FORMAT fmt) {
  D3D11_TEXTURE2D_DESC d = {};
  d.Width = w;
  d.Height = h;
  d.MipLevels = 1;
  d.ArraySize = 1;
  d.Format = fmt;
  d.SampleDesc.Count = 1;
  d.Usage = D3D11_USAGE_DEFAULT;
  d.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET;
  d.MiscFlags = D3D11_RESOURCE_MISC_SHARED | D3D11_RESOURCE_MISC_SHARED_NTHANDLE;
  for (auto& s : r.slot) {
    if (FAILED(dev->CreateTexture2D(&d, nullptr, &s.tex)) || !s.tex) { r.Free(); return false; }
    IDXGIResource1* res = nullptr;
    if (FAILED(s.tex->QueryInterface(__uuidof(IDXGIResource1), (void**)&res)) || !res) { r.Free(); return false; }
    HRESULT hr = res->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE, nullptr, &s.nt);
    res->Release();
    if (FAILED(hr) || !s.nt) { r.Free(); return false; }
  }
  r.w = w;
  r.h = h;
  return true;
}

static void RunGpu(std::shared_ptr<SpoutRx> rx) {
  ID3D11Device* dev = MakeDevice();
  if (!dev) {
    std::lock_guard<std::mutex> lk(rx->mx);
    rx->state = RxState::Failed;
    rx->error = "no DirectX 11 device";
    return;
  }
  ID3D11DeviceContext* ctx = nullptr;
  dev->GetImmediateContext(&ctx);
  ID3D11Query* done = nullptr;
  D3D11_QUERY_DESC qd = { D3D11_QUERY_EVENT, 0 };
  dev->CreateQuery(&qd, &done);

  spoutDX sp;
  sp.OpenDirectX11(dev);
  sp.SetReceiverName(rx->name.c_str());
  Ticker tick;
  Pacer pace;
  bool away = false;
  ID3D11Texture2D* none = nullptr;
  bool counted = true; // the sender counts its frames : poll fast, copy only new ones
  int missing = 0;

  while (!rx->stop.load()) {
    // A sender that does not count its frames looks new on every call : then
    // copy at most 120 times a second instead of a thousand.
    // No sender (yet, or it closed) : looked for 20 times a second, not 1000.
    tick.Wait(away ? 50.0 : pace.Next(counted));
    Ring* cur = nullptr;
    int target = -1;
    {
      std::lock_guard<std::mutex> lk(rx->mx);
      cur = rx->Current();
      if (cur) {
        // The slot to write : neither the newest frame nor the two the page read last.
        for (int k = 1; k <= RING; ++k) {
          int s = (rx->published + k + RING) % RING;
          if (s != rx->published && s != rx->taken && s != rx->takenBefore) { target = s; break; }
        }
      }
    }
    ID3D11Texture2D* dst = (cur && target >= 0) ? cur->slot[target].tex : nullptr;
    bool ok = sp.ReceiveTexture(dst ? &dst : &none);
    if (sp.IsUpdated()) {
      const unsigned w = sp.GetSenderWidth(), h = sp.GetSenderHeight();
      const DWORD f = (DWORD)sp.GetSenderFormat();
      FormatWay way = WayFor(f);
      std::unique_ptr<Ring> r(new Ring());
      bool made = way.ring != DXGI_FORMAT_UNKNOWN && w > 0 && h > 0 && MakeRing(dev, *r, w, h, way.ring);
      std::lock_guard<std::mutex> lk(rx->mx);
      rx->w = w;
      rx->h = h;
      rx->format = f;
      if (made) {
        r->gen = ++rx->gen;
        r->pixel = way.pixel;
        rx->rings.push_back(std::move(r));
        rx->published = rx->taken = rx->takenBefore = -1;
        rx->state = RxState::Live;
        rx->error.clear();
      } else {
        rx->state = way.ring == DXGI_FORMAT_UNKNOWN ? RxState::Unsupported : RxState::Failed;
        rx->error = way.ring == DXGI_FORMAT_UNKNOWN ? "this sender's pixel format cannot be shared" : "could not make the shared textures";
      }
      continue;
    }
    away = !ok;
    if (!ok) {
      // No sender by that name (closed, not started yet), or one this graphics
      // card cannot open (another card) : looked for again on the next turn.
      bool listed = false;
      {
        unsigned w = 0, h = 0; HANDLE hh = nullptr; DWORD f = 0;
        listed = sp.GetSenderInfo(rx->name.c_str(), w, h, hh, f);
      }
      std::lock_guard<std::mutex> lk(rx->mx);
      const bool stuck = rx->state == RxState::Unsupported || rx->state == RxState::Failed;
      if (listed && stuck) {
        // a format this route cannot carry : said once, until the sender changes
      } else if (listed && ++missing > 30) {
        rx->state = RxState::OtherGpu;
        rx->error = "the sender draws on another graphics card";
      } else if (!listed) {
        missing = 0;
        if (rx->state == RxState::Live || rx->state == RxState::OtherGpu) rx->state = RxState::Waiting;
      }
      rx->fps = 0;
      continue;
    }
    missing = 0;
    counted = sp.IsFrameCountEnabled() && sp.GetSenderFrame() > 0;
    if (!dst || !sp.IsFrameNew()) continue;
    // Wait (on this thread) for the copy to land before the page may read it.
    if (done) {
      ctx->End(done);
      ctx->Flush();
      // Sleeping between looks (a spin here cost several % of a core).
      BOOL fin = FALSE;
      for (int i = 0; i < 200 && !rx->stop.load(); ++i) {
        if (ctx->GetData(done, &fin, sizeof(fin), 0) == S_OK && fin) break;
        tick.Wait(0.25);
      }
    }
    std::lock_guard<std::mutex> lk(rx->mx);
    if (rx->Current() != cur) continue; // resized meanwhile
    rx->published = target;
    rx->seq++;
    rx->stampMs = NowMs();
    pace.Got();
    rx->fps = sp.GetSenderFps();
    rx->senderFrame = sp.GetSenderFrame();
    rx->state = RxState::Live;
  }
  sp.ReleaseReceiver();
  {
    std::lock_guard<std::mutex> lk(rx->mx);
    for (auto& r : rx->rings) r->Free();
    rx->rings.clear();
  }
  if (done) done->Release();
  if (ctx) { ctx->ClearState(); ctx->Flush(); ctx->Release(); }
  sp.CloseDirectX11();
  dev->Release();
}

// The CPU route reads each new frame at once (copy to a staging texture, then
// map it : the map waits for the copy, on this thread) rather than through the
// SDK's two staging textures, which deliver every frame one sender frame late.
static void RunCpu(std::shared_ptr<SpoutRx> rx) {
  spoutDX sp;
  if (!sp.OpenDirectX11()) {
    std::lock_guard<std::mutex> lk(rx->mx);
    rx->state = RxState::Failed;
    rx->error = "no DirectX 11 device";
    return;
  }
  sp.SetAdapterAuto(true); // follow the sender to its graphics card (needs the class's own device)
  sp.SetReceiverName(rx->name.c_str());
  spoutCopy cp;
  Ticker tick;
  Pacer pace;
  bool away = false;
  bool counted = true;
  unsigned bw = 0, bh = 0;
  bool swap = false, opaque = false; // BGRA : swapped to RGBA; BGRX : the fourth byte is not alpha
  ID3D11Texture2D* staging = nullptr;
  ID3D11Texture2D* none = nullptr;
  while (!rx->stop.load()) {
    // No sender (yet, or it closed) : looked for 20 times a second, not 1000.
    tick.Wait(away ? 50.0 : pace.Next(counted));
    bool ok = sp.ReceiveTexture(staging ? &staging : &none);
    if (sp.IsUpdated()) {
      const unsigned w = sp.GetSenderWidth(), h = sp.GetSenderHeight();
      const DWORD f = (DWORD)sp.GetSenderFormat();
      FormatWay way = WayFor(f);
      swap = way.swap;
      opaque = f == DXGI_FORMAT_B8G8R8X8_UNORM || f == DXGI_FORMAT_B8G8R8X8_TYPELESS || f == DXGI_FORMAT_B8G8R8X8_UNORM_SRGB;
      if (staging) { staging->Release(); staging = nullptr; }
      // (the class device may have moved to the sender's card : asked again)
      ID3D11Device* dev = sp.GetDX11Device();
      if (way.cpu && w && h && dev) {
        D3D11_TEXTURE2D_DESC d = {};
        d.Width = w;
        d.Height = h;
        d.MipLevels = 1;
        d.ArraySize = 1;
        d.Format = (DXGI_FORMAT)f;
        d.SampleDesc.Count = 1;
        d.Usage = D3D11_USAGE_STAGING;
        d.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
        if (FAILED(dev->CreateTexture2D(&d, nullptr, &staging))) staging = nullptr;
      }
      std::lock_guard<std::mutex> lk(rx->mx);
      rx->w = w;
      rx->h = h;
      rx->format = f;
      if (staging) {
        bw = w;
        bh = h;
        rx->back.assign((size_t)w * h * 4, 0);
        rx->state = RxState::Live;
        rx->error.clear();
      } else {
        bw = bh = 0;
        rx->state = way.cpu ? RxState::Failed : RxState::Unsupported;
        rx->error = way.cpu ? "could not read this sender" : "this sender's pixel format cannot be read";
      }
      continue;
    }
    away = !ok;
    if (!ok) {
      std::lock_guard<std::mutex> lk(rx->mx);
      if (rx->state == RxState::Live) rx->state = RxState::Waiting;
      rx->fps = 0;
      continue;
    }
    counted = sp.IsFrameCountEnabled() && sp.GetSenderFrame() > 0;
    if (!staging || !sp.IsFrameNew()) continue;
    ID3D11DeviceContext* ctx = sp.GetDX11Context();
    D3D11_MAPPED_SUBRESOURCE map = {};
    if (!ctx || FAILED(ctx->Map(staging, 0, D3D11_MAP_READ, 0, &map))) continue;
    if (swap) cp.rgba2bgra(map.pData, rx->back.data(), bw, bh, map.RowPitch, false);
    else cp.rgba2rgba(map.pData, rx->back.data(), bw, bh, map.RowPitch, false);
    ctx->Unmap(staging, 0);
    if (opaque) for (size_t i = 3; i < rx->back.size(); i += 4) rx->back[i] = 255;
    std::lock_guard<std::mutex> lk(rx->mx);
    rx->front.swap(rx->back);
    if (rx->back.size() != rx->front.size()) rx->back.assign(rx->front.size(), 0);
    rx->fw = bw;
    rx->fh = bh;
    rx->seq++;
    rx->stampMs = NowMs();
    pace.Got();
    rx->fps = sp.GetSenderFps();
    rx->senderFrame = sp.GetSenderFrame();
    rx->state = RxState::Live;
  }
  if (staging) staging->Release();
  sp.ReleaseReceiver();
  sp.CloseDirectX11();
}

static std::shared_ptr<SpoutRx> Find(const Napi::CallbackInfo& info) {
  if (info.Length() < 1 || !info[0].IsNumber()) return nullptr;
  int id = info[0].As<Napi::Number>().Int32Value();
  std::lock_guard<std::mutex> lk(g_rxMx);
  auto it = g_rx.find(id);
  return it == g_rx.end() ? nullptr : it->second;
}

// adapters() → the graphics cards' names, in DXGI order (diagnostics, tests).
Napi::Value Adapters(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array out = Napi::Array::New(env);
  IDXGIFactory1* f = nullptr;
  if (FAILED(CreateDXGIFactory1(__uuidof(IDXGIFactory1), (void**)&f)) || !f) return out;
  IDXGIAdapter1* a = nullptr;
  for (UINT i = 0; f->EnumAdapters1(i, &a) != DXGI_ERROR_NOT_FOUND; ++i) {
    DXGI_ADAPTER_DESC1 d = {};
    a->GetDesc1(&d);
    a->Release();
    char nm[256] = {};
    WideCharToMultiByte(CP_UTF8, 0, d.Description, -1, nm, sizeof(nm) - 1, nullptr, nullptr);
    out.Set(i, std::string(nm));
  }
  f->Release();
  return out;
}

// senders() → [{ name, w, h, format }] : every Spout sender on this computer.
Napi::Value Senders(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  spoutSenderNames names;
  std::set<std::string> set;
  Napi::Array out = Napi::Array::New(env);
  if (!names.GetSenderNames(&set)) return out;
  uint32_t i = 0;
  for (const auto& n : set) {
    unsigned w = 0, h = 0; HANDLE hh = nullptr; DWORD f = 0;
    if (!names.GetSenderInfo(n.c_str(), w, h, hh, f)) continue;
    Napi::Object o = Napi::Object::New(env);
    o.Set("name", n);
    o.Set("w", w);
    o.Set("h", h);
    o.Set("format", (double)f);
    out.Set(i++, o);
  }
  return out;
}

// recvOpen(name, gpu) → id. Starts a receiver thread; it waits for the sender
// if it is not there yet.
Napi::Value RecvOpen(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto rx = std::make_shared<SpoutRx>();
  rx->name = info[0].As<Napi::String>().Utf8Value();
  rx->gpu = !(info.Length() > 1 && info[1].IsBoolean() && !info[1].As<Napi::Boolean>().Value());
  int id;
  {
    std::lock_guard<std::mutex> lk(g_rxMx);
    id = g_nextRx++;
    g_rx[id] = rx;
  }
  rx->th = std::thread(rx->gpu ? RunGpu : RunCpu, rx);
  return Napi::Number::New(env, id);
}

// recvState(id) → { state, w, h, format, fps, frame, seq, gen, stamp, error, gpu }
Napi::Value RecvState(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto rx = Find(info);
  if (!rx) return env.Null();
  std::lock_guard<std::mutex> lk(rx->mx);
  Napi::Object o = Napi::Object::New(env);
  o.Set("state", StateName(rx->state));
  o.Set("w", rx->w);
  o.Set("h", rx->h);
  o.Set("format", (double)rx->format);
  o.Set("fps", rx->fps);
  o.Set("frame", (double)rx->senderFrame);
  o.Set("seq", (double)rx->seq);
  o.Set("gen", rx->gpu && rx->Current() ? rx->Current()->gen : 0);
  o.Set("stamp", rx->stampMs);
  o.Set("error", rx->error);
  o.Set("gpu", rx->gpu);
  return o;
}

// recvRing(id) → { gen, w, h, pixel, handles: Buffer[4] } : the current shared
// textures (NT handles, valid in this process) for the page to import once.
Napi::Value RecvRing(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto rx = Find(info);
  if (!rx) return env.Null();
  std::lock_guard<std::mutex> lk(rx->mx);
  Ring* r = rx->Current();
  if (!r) return env.Null();
  Napi::Object o = Napi::Object::New(env);
  o.Set("gen", r->gen);
  o.Set("w", r->w);
  o.Set("h", r->h);
  o.Set("pixel", r->pixel);
  Napi::Array hs = Napi::Array::New(env, RING);
  for (int k = 0; k < RING; ++k) {
    uint64_t v = (uint64_t)(uintptr_t)r->slot[k].nt;
    hs.Set((uint32_t)k, Napi::Buffer<uint8_t>::Copy(env, (const uint8_t*)&v, sizeof(v)));
  }
  o.Set("handles", hs);
  return o;
}

// recvTake(id) → { gen, slot, seq, stamp } | null : the newest frame's slot,
// held back from writing until the page has moved two frames past it.
Napi::Value RecvTake(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto rx = Find(info);
  if (!rx) return env.Null();
  std::lock_guard<std::mutex> lk(rx->mx);
  Ring* r = rx->Current();
  if (!r || rx->published < 0 || rx->seq == rx->takenSeq) return env.Null();
  if (rx->taken != rx->published) {
    rx->takenBefore = rx->taken;
    rx->taken = rx->published;
  }
  rx->takenSeq = rx->seq;
  Napi::Object o = Napi::Object::New(env);
  o.Set("gen", r->gen);
  o.Set("slot", rx->published);
  o.Set("seq", (double)rx->seq);
  o.Set("stamp", rx->stampMs);
  return o;
}

// recvRetire(id, gen) : the page let go of every import older than `gen`.
Napi::Value RecvRetire(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto rx = Find(info);
  if (!rx || info.Length() < 2) return env.Undefined();
  const int gen = info[1].As<Napi::Number>().Int32Value();
  std::lock_guard<std::mutex> lk(rx->mx);
  for (size_t i = 0; i + 1 < rx->rings.size();) {
    if (rx->rings[i]->gen < gen) {
      rx->rings[i]->Free();
      rx->rings.erase(rx->rings.begin() + i);
    } else {
      ++i;
    }
  }
  return env.Undefined();
}

// CPU route : copy the newest frame into the page's buffer off this thread.
class ReadWorker : public Napi::AsyncWorker {
 public:
  ReadWorker(Napi::Env env, std::shared_ptr<SpoutRx> rx, Napi::ArrayBuffer ab, uint64_t after)
      : Napi::AsyncWorker(env), rx_(rx), ref_(Napi::Persistent(ab)), dst_((uint8_t*)ab.Data()),
        cap_(ab.ByteLength()), after_(after), def_(Napi::Promise::Deferred::New(env)) {}
  Napi::Promise Promise() { return def_.Promise(); }
  void Execute() override {
    std::lock_guard<std::mutex> lk(rx_->mx);
    if (rx_->seq <= after_ || rx_->front.empty()) return;
    const size_t n = (size_t)rx_->fw * rx_->fh * 4;
    if (n > cap_ || rx_->front.size() < n) { short_ = true; w_ = rx_->fw; h_ = rx_->fh; return; }
    memcpy(dst_, rx_->front.data(), n);
    w_ = rx_->fw;
    h_ = rx_->fh;
    seq_ = rx_->seq;
    stamp_ = rx_->stampMs;
  }
  void OnOK() override {
    Napi::Env env = Env();
    Napi::Object o = Napi::Object::New(env);
    o.Set("seq", (double)seq_);
    o.Set("w", w_);
    o.Set("h", h_);
    o.Set("stamp", stamp_);
    o.Set("short", short_);
    def_.Resolve(o);
  }
  void OnError(const Napi::Error& e) override { def_.Reject(e.Value()); }
 private:
  std::shared_ptr<SpoutRx> rx_;
  Napi::Reference<Napi::ArrayBuffer> ref_;
  uint8_t* dst_;
  size_t cap_;
  uint64_t after_;
  Napi::Promise::Deferred def_;
  uint64_t seq_ = 0;
  unsigned w_ = 0, h_ = 0;
  double stamp_ = 0;
  bool short_ = false;
};

// recvRead(id, arrayBuffer, afterSeq) → Promise<{ seq, w, h, stamp, short }> :
// seq 0 = nothing newer; short = the buffer is too small for (w, h).
Napi::Value RecvRead(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto rx = Find(info);
  if (!rx || info.Length() < 3 || !info[1].IsArrayBuffer()) {
    auto d = Napi::Promise::Deferred::New(env);
    d.Reject(Napi::Error::New(env, "no such receiver").Value());
    return d.Promise();
  }
  auto* w = new ReadWorker(env, rx, info[1].As<Napi::ArrayBuffer>(), (uint64_t)info[2].As<Napi::Number>().Int64Value());
  Napi::Promise p = w->Promise();
  w->Queue();
  return p;
}

static void StopRx(std::shared_ptr<SpoutRx> rx) {
  rx->stop.store(true);
  // The thread frees its own textures and device; detached, so a closing
  // sender's 67 ms never stalls the caller.
  if (rx->th.joinable()) rx->th.detach();
}

// recvClose(id) : stops that receiver.
Napi::Value RecvClose(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) return env.Undefined();
  int id = info[0].As<Napi::Number>().Int32Value();
  std::shared_ptr<SpoutRx> rx;
  {
    std::lock_guard<std::mutex> lk(g_rxMx);
    auto it = g_rx.find(id);
    if (it == g_rx.end()) return env.Undefined();
    rx = it->second;
    g_rx.erase(it);
  }
  StopRx(rx);
  return env.Undefined();
}

// A reloaded page gets a fresh JS world in the same process : the receivers
// the old one left running are stopped with it.
static void StopAll() {
  std::map<int, std::shared_ptr<SpoutRx>> all;
  {
    std::lock_guard<std::mutex> lk(g_rxMx);
    all.swap(g_rx);
  }
  for (auto& kv : all) StopRx(kv.second);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("open", Napi::Function::New(env, Open));
  exports.Set("send", Napi::Function::New(env, Send));
  exports.Set("close", Napi::Function::New(env, Close));
  // Tells the app this build understands send(…, topDown) (older builds ignore
  // the argument and flip : the app then sends bottom-up frames instead).
  exports.Set("topDown", Napi::Boolean::New(env, true));
  // Receiving (the Spout / Syphon Input source).
  exports.Set("senders", Napi::Function::New(env, Senders));
  exports.Set("adapters", Napi::Function::New(env, Adapters));
  exports.Set("recvOpen", Napi::Function::New(env, RecvOpen));
  exports.Set("recvState", Napi::Function::New(env, RecvState));
  exports.Set("recvRing", Napi::Function::New(env, RecvRing));
  exports.Set("recvTake", Napi::Function::New(env, RecvTake));
  exports.Set("recvRetire", Napi::Function::New(env, RecvRetire));
  exports.Set("recvRead", Napi::Function::New(env, RecvRead));
  exports.Set("recvClose", Napi::Function::New(env, RecvClose));
  exports.Set("receives", Napi::Boolean::New(env, true));
  env.AddCleanupHook([]() { StopAll(); });
  return exports;
}

NODE_API_MODULE(spout, Init)
