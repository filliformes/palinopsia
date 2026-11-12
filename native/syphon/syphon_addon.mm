// Palinopsia Syphon sender AND client : a minimal N-API addon over the Syphon
// framework (macOS), the twin of native/spout. SENDER : SyphonMetalServer, the
// app publishes its composite as a Syphon source (Resolume, MadMapper,
// TouchDesigner, VDMX, OBS…) straight from the readback pixels. CLIENT (the
// "Spout / Syphon Input" layer source) : SyphonServerDirectory + SyphonMetalClient,
// run in the MAIN process (src/main/syphonIn.ts), which hands each server's
// IOSurface to the window; readSurface() is the window's copy route.
// Metal needs no window, so all of it runs headless. Syphon framework : BSD
// (Syphon/Syphon-Framework), built by build.sh and shipped next to this .node.
// The client part is UNTESTED (written 2026-11-11 without a Mac).

#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#import <Syphon/SyphonMetalServer.h>
#import <Syphon/SyphonMetalClient.h>
#import <Syphon/SyphonServerDirectory.h>
#import <IOSurface/IOSurface.h>
#include <napi.h>
#include <atomic>
#include <chrono>
#include <map>
#include <memory>
#include <string>

static id<MTLDevice> g_device = nil;
static id<MTLCommandQueue> g_queue = nil;
static SyphonMetalServer* g_server = nil;
static id<MTLTexture> g_tex = nil;
static id<MTLCommandBuffer> g_last = nil;

// open(name) → bool. Creates the server : it appears in every Syphon client.
static Napi::Value Open(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string name = info.Length() > 0 && info[0].IsString() ? info[0].As<Napi::String>().Utf8Value() : "Palinopsia";
  @autoreleasepool {
    if (!g_device) g_device = MTLCreateSystemDefaultDevice();
    if (!g_device) return Napi::Boolean::New(env, false);
    if (!g_queue) g_queue = [g_device newCommandQueue];
    if (!g_server) {
      g_server = [[SyphonMetalServer alloc] initWithName:[NSString stringWithUTF8String:name.c_str()]
                                                  device:g_device
                                                 options:nil];
    }
    return Napi::Boolean::New(env, g_server != nil);
  }
}

// send(buffer, width, height[, topDown]). RGBA8, GL bottom-up : Syphon flips it
// (flipped:YES); topDown = already top-down (the GPU flipped it).
static Napi::Value Send(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_server || info.Length() < 3 || !info[0].IsBuffer()) return env.Undefined();
  Napi::Buffer<uint8_t> buf = info[0].As<Napi::Buffer<uint8_t>>();
  const NSUInteger w = info[1].As<Napi::Number>().Uint32Value();
  const NSUInteger h = info[2].As<Napi::Number>().Uint32Value();
  const bool topDown = info.Length() > 3 && info[3].IsBoolean() && info[3].As<Napi::Boolean>().Value();
  if (!w || !h || buf.Length() < w * h * 4) return env.Undefined();
  @autoreleasepool {
    // Nobody watching : skip the upload entirely.
    if (!g_server.hasClients) return env.Undefined();
    if (!g_tex || g_tex.width != w || g_tex.height != h) {
      MTLTextureDescriptor* d = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA8Unorm
                                                                                   width:w
                                                                                  height:h
                                                                               mipmapped:NO];
      d.usage = MTLTextureUsageShaderRead;
#if defined(__arm64__)
      d.storageMode = MTLStorageModeShared; // unified memory
#else
      d.storageMode = MTLStorageModeManaged; // Intel : shared textures aren't allowed
#endif
      g_tex = [g_device newTextureWithDescriptor:d];
      if (!g_tex) return env.Undefined();
    }
    // The previous publish may still be reading the texture on the GPU.
    if (g_last) {
      [g_last waitUntilCompleted];
      g_last = nil;
    }
    [g_tex replaceRegion:MTLRegionMake2D(0, 0, w, h) mipmapLevel:0 withBytes:buf.Data() bytesPerRow:w * 4];
    id<MTLCommandBuffer> cb = [g_queue commandBuffer];
    [g_server publishFrameTexture:g_tex onCommandBuffer:cb imageRegion:NSMakeRect(0, 0, w, h) flipped:(topDown ? NO : YES)];
    [cb commit];
    g_last = cb;
  }
  return env.Undefined();
}

// close(). Stops the server : it leaves the clients' lists.
static Napi::Value Close(const Napi::CallbackInfo& info) {
  @autoreleasepool {
    if (g_last) {
      [g_last waitUntilCompleted];
      g_last = nil;
    }
    [g_server stop];
    g_server = nil;
    g_tex = nil;
  }
  return info.Env().Undefined();
}

// ─── Client (the Syphon input) ──────────────────────────────────────────────

// How a server is shown and found again : "app : name", or whichever exists.
static NSString* LabelOf(NSDictionary* d) {
  id n = d[SyphonServerDescriptionNameKey];
  id a = d[SyphonServerDescriptionAppNameKey];
  NSString* name = [n isKindOfClass:[NSString class]] ? (NSString*)n : @"";
  NSString* app = [a isKindOfClass:[NSString class]] ? (NSString*)a : @"";
  if (name.length && app.length) return [NSString stringWithFormat:@"%@ : %@", app, name];
  return name.length ? name : app;
}

static double NowSec() {
  using namespace std::chrono;
  return duration_cast<duration<double>>(steady_clock::now().time_since_epoch()).count();
}

struct SyRx {
  std::string label;
  SyphonMetalClient* client = nil;
  std::shared_ptr<std::atomic<uint64_t>> frames = std::make_shared<std::atomic<uint64_t>>(0);
  IOSurfaceRef surface = nullptr; // retained : main imports it from here
  uint32_t surfaceId = 0;
  unsigned w = 0, h = 0;
  uint64_t seq = 0;
  int gen = 0;
  double lastLook = -10;
  bool everLive = false;
  std::string error;
  // the frame rate, counted here
  uint64_t fpsN = 0;
  double fpsT = 0, fps = 0;
  ~SyRx() {
    if (client) [client stop];
    client = nil;
    if (surface) CFRelease(surface);
  }
};

static std::map<int, std::unique_ptr<SyRx>> g_rx;
static int g_nextRx = 1;

static SyRx* FindRx(const Napi::CallbackInfo& info) {
  if (info.Length() < 1 || !info[0].IsNumber()) return nullptr;
  auto it = g_rx.find(info[0].As<Napi::Number>().Int32Value());
  return it == g_rx.end() ? nullptr : it->second.get();
}

static std::string Utf8(id v) {
  return [v isKindOfClass:[NSString class]] ? std::string([(NSString*)v UTF8String] ?: "") : std::string();
}

// servers() → [{ label, name, app }] : every Syphon server on this Mac. The
// first call starts the directory; servers announce themselves a moment later.
static Napi::Value Servers(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array out = Napi::Array::New(env);
  @autoreleasepool {
    NSArray* list = [[SyphonServerDirectory sharedDirectory] servers];
    uint32_t i = 0;
    for (NSDictionary* d in list) {
      NSString* label = LabelOf(d);
      if (!label.length) continue;
      Napi::Object o = Napi::Object::New(env);
      o.Set("label", Utf8(label));
      o.Set("name", Utf8(d[SyphonServerDescriptionNameKey]));
      o.Set("app", Utf8(d[SyphonServerDescriptionAppNameKey]));
      out.Set(i++, o);
    }
  }
  return out;
}

// recvOpen(label) → id. The client connects when a server with that label shows up.
static Napi::Value RecvOpen(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::unique_ptr<SyRx> rx(new SyRx());
  rx->label = info.Length() > 0 && info[0].IsString() ? info[0].As<Napi::String>().Utf8Value() : "";
  @autoreleasepool {
    (void)[SyphonServerDirectory sharedDirectory]; // start listening now
    if (!g_device) g_device = MTLCreateSystemDefaultDevice();
  }
  const int id = g_nextRx++;
  g_rx[id] = std::move(rx);
  return Napi::Number::New(env, id);
}

// recvPoll(id) → { state, w, h, seq, gen, surfaceId, fps, error }. Called often
// (every few ms) on the main thread : connects, notices new frames, and a new
// surface (gen) when the server changes size.
static Napi::Value RecvPoll(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  SyRx* rx = FindRx(info);
  if (!rx) return env.Null();
  std::string state = "waiting";
  @autoreleasepool {
    if (rx->client && !rx->client.isValid) {
      // The server stopped : looked for again below, by its label.
      [rx->client stop];
      rx->client = nil;
      rx->fps = 0;
    }
    if (!rx->client) {
      rx->everLive = false;
      const double now = NowSec();
      if (now - rx->lastLook > 0.5 && g_device) {
        rx->lastLook = now;
        NSArray* list = [[SyphonServerDirectory sharedDirectory] servers];
        // By its label ("app : name") first, else by the server's own name :
        // a session saved on Windows names a Spout sender, which a Mac program
        // publishes over Syphon under the same name.
        NSDictionary* match = nil;
        for (NSDictionary* d in list) {
          if (Utf8(LabelOf(d)) == rx->label) { match = d; break; }
        }
        if (!match && !rx->label.empty()) {
          for (NSDictionary* d in list) {
            if (Utf8(d[SyphonServerDescriptionNameKey]) == rx->label) { match = d; break; }
          }
        }
        if (match) {
          NSDictionary* d = match;
          std::shared_ptr<std::atomic<uint64_t>> frames = rx->frames;
          SyphonMetalClient* c = [[SyphonMetalClient alloc] initWithServerDescription:d
                                                                               device:g_device
                                                                              options:nil
                                                                      newFrameHandler:^(SyphonMetalClient* client) {
                                                                        (void)client;
                                                                        frames->fetch_add(1);
                                                                      }];
          if (c && c.isValid) rx->client = c;
          else if (c) [c stop];
        }
      }
    }
    if (rx->client) {
      if (rx->everLive) state = "live";
      if (rx->client.hasNewFrame) {
        id<MTLTexture> tex = [rx->client newFrameImage];
        IOSurfaceRef s = tex ? tex.iosurface : nullptr;
        if (s) {
          if (s != rx->surface) {
            CFRetain(s);
            if (rx->surface) CFRelease(rx->surface);
            rx->surface = s;
            rx->gen++;
          }
          rx->surfaceId = IOSurfaceGetID(s);
          rx->w = (unsigned)IOSurfaceGetWidth(s);
          rx->h = (unsigned)IOSurfaceGetHeight(s);
          rx->seq++;
          rx->everLive = true;
          state = "live";
          const double now = NowSec();
          rx->fpsN++;
          if (now - rx->fpsT >= 1.0) {
            rx->fps = rx->fpsT > 0 ? rx->fpsN / (now - rx->fpsT) : 0;
            rx->fpsN = 0;
            rx->fpsT = now;
          }
        }
      }
    }
  }
  Napi::Object o = Napi::Object::New(env);
  o.Set("state", state);
  o.Set("w", rx->w);
  o.Set("h", rx->h);
  o.Set("seq", (double)rx->seq);
  o.Set("gen", rx->gen);
  o.Set("surfaceId", (double)rx->surfaceId);
  o.Set("fps", rx->fps);
  o.Set("error", rx->error);
  return o;
}

// recvSurface(id) → a Buffer holding the IOSurfaceRef (valid in THIS process,
// kept alive by the receiver until the next surface), for sharedTexture's ioSurface.
static Napi::Value RecvSurface(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  SyRx* rx = FindRx(info);
  if (!rx || !rx->surface) return env.Null();
  uint64_t v = (uint64_t)(uintptr_t)rx->surface;
  return Napi::Buffer<uint8_t>::Copy(env, (const uint8_t*)&v, sizeof(v));
}

static Napi::Value RecvClose(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) return env.Undefined();
  @autoreleasepool {
    g_rx.erase(info[0].As<Napi::Number>().Int32Value());
  }
  return env.Undefined();
}

// The copy route (in the window) : a server's surface by its global id, BGRA
// swapped to RGBA into the page's buffer, off the calling thread.
class ReadSurfaceWorker : public Napi::AsyncWorker {
 public:
  ReadSurfaceWorker(Napi::Env env, uint32_t sid, Napi::ArrayBuffer ab)
      : Napi::AsyncWorker(env), sid_(sid), ref_(Napi::Persistent(ab)), dst_((uint8_t*)ab.Data()),
        cap_(ab.ByteLength()), def_(Napi::Promise::Deferred::New(env)) {}
  Napi::Promise Promise() { return def_.Promise(); }
  void Execute() override {
    IOSurfaceRef s = IOSurfaceLookup(sid_);
    if (!s) return;
    w_ = (unsigned)IOSurfaceGetWidth(s);
    h_ = (unsigned)IOSurfaceGetHeight(s);
    const size_t need = (size_t)w_ * h_ * 4;
    if (need > cap_) {
      short_ = true;
      CFRelease(s);
      return;
    }
    if (IOSurfaceLock(s, kIOSurfaceLockReadOnly, nullptr) == kIOReturnSuccess) {
      const uint8_t* base = (const uint8_t*)IOSurfaceGetBaseAddress(s);
      const size_t bpr = IOSurfaceGetBytesPerRow(s);
      const bool rgba = IOSurfaceGetPixelFormat(s) == 'RGBA';
      for (unsigned y = 0; y < h_; ++y) {
        const uint8_t* src = base + y * bpr;
        uint8_t* dst = dst_ + (size_t)y * w_ * 4;
        if (rgba) {
          memcpy(dst, src, (size_t)w_ * 4);
          continue;
        }
        for (unsigned x = 0; x < w_; ++x) {
          dst[0] = src[2];
          dst[1] = src[1];
          dst[2] = src[0];
          dst[3] = src[3];
          src += 4;
          dst += 4;
        }
      }
      IOSurfaceUnlock(s, kIOSurfaceLockReadOnly, nullptr);
      ok_ = true;
    }
    CFRelease(s);
  }
  void OnOK() override {
    Napi::Env env = Env();
    Napi::Object o = Napi::Object::New(env);
    o.Set("ok", ok_);
    o.Set("w", w_);
    o.Set("h", h_);
    o.Set("short", short_);
    def_.Resolve(o);
  }
  void OnError(const Napi::Error& e) override { def_.Reject(e.Value()); }

 private:
  uint32_t sid_;
  Napi::Reference<Napi::ArrayBuffer> ref_;
  uint8_t* dst_;
  size_t cap_;
  Napi::Promise::Deferred def_;
  unsigned w_ = 0, h_ = 0;
  bool ok_ = false, short_ = false;
};

// readSurface(surfaceId, arrayBuffer) → Promise<{ ok, w, h, short }>
static Napi::Value ReadSurface(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsArrayBuffer()) {
    auto d = Napi::Promise::Deferred::New(env);
    d.Reject(Napi::Error::New(env, "readSurface(surfaceId, arrayBuffer)").Value());
    return d.Promise();
  }
  auto* w = new ReadSurfaceWorker(env, info[0].As<Napi::Number>().Uint32Value(), info[1].As<Napi::ArrayBuffer>());
  Napi::Promise p = w->Promise();
  w->Queue();
  return p;
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("open", Napi::Function::New(env, Open));
  exports.Set("send", Napi::Function::New(env, Send));
  exports.Set("close", Napi::Function::New(env, Close));
  exports.Set("topDown", Napi::Boolean::New(env, true)); // understands send(…, topDown)
  // Receiving (the Spout / Syphon Input source).
  exports.Set("servers", Napi::Function::New(env, Servers));
  exports.Set("recvOpen", Napi::Function::New(env, RecvOpen));
  exports.Set("recvPoll", Napi::Function::New(env, RecvPoll));
  exports.Set("recvSurface", Napi::Function::New(env, RecvSurface));
  exports.Set("recvClose", Napi::Function::New(env, RecvClose));
  exports.Set("readSurface", Napi::Function::New(env, ReadSurface));
  exports.Set("receives", Napi::Boolean::New(env, true));
  return exports;
}

NODE_API_MODULE(syphon, Init)
