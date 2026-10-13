// Palinopsia AVFoundation input (macOS) : the cameras Chromium cannot see.
//
// First of all an iPhone or iPad plugged in by USB. macOS shows its screen as a
// camera (what QuickTime's New Movie Recording offers), but only to an app that
// opts in (kCMIOHardwarePropertyAllowScreenCaptureDevices), and as a MUXED
// device (sound and picture in one), which Chromium's own enumeration skips : it
// asks AVFoundation for video-type devices only. This addon opts in, lists the
// video AND muxed devices, and captures one : each frame is scaled (vImage, when
// a size cap asks), turned from BGRA into RGBA, and kept as the newest frame for
// the preload to copy out (src/preload/avcapture.ts). Same recipe as OBS's
// mac-avcapture : the opt-in, a muxed discovery session, a BGRA output.
//
// Runs in the window's own process (the preload), like the NDI receiver : a frame
// handed to the page by transfer costs nothing, where IPC copies it.

#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreMediaIO/CMIOHardware.h>
#import <CoreVideo/CoreVideo.h>
#import <Accelerate/Accelerate.h>
#include <napi.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#pragma clang diagnostic ignored "-Wdeprecated-declarations"

// ── Opting in to screen-capture devices ─────────────────────────────────────

static std::atomic<bool> g_enabled{false};

// The DAL publishes an iPhone only after this, and asynchronously (about a
// second later), through the main thread's run loop : the window's main thread
// runs one (Chromium's pump on macOS is CFRunLoop-based).
static void Enable() {
  if (g_enabled.exchange(true)) return;
  CMIOObjectPropertyAddress allow = {kCMIOHardwarePropertyAllowScreenCaptureDevices, kCMIOObjectPropertyScopeGlobal,
                                     (CMIOObjectPropertyElement)0 /* main */};
  UInt32 yes = 1;
  CMIOObjectSetPropertyData(kCMIOObjectSystemObject, &allow, 0, NULL, sizeof(yes), &yes);
}

// Every video and muxed device, each once. The discovery sessions first (the
// device types differ before and after macOS 14), then the older class list as a
// net for anything they miss.
static NSArray<AVCaptureDevice*>* Devices() {
  Enable();
  NSMutableArray<AVCaptureDevice*>* out = [NSMutableArray array];
  NSMutableSet<NSString*>* seen = [NSMutableSet set];
  void (^add)(NSArray<AVCaptureDevice*>*) = ^(NSArray<AVCaptureDevice*>* list) {
    for (AVCaptureDevice* d in list) {
      if (!d.uniqueID || [seen containsObject:d.uniqueID]) continue;
      if (![d hasMediaType:AVMediaTypeVideo] && ![d hasMediaType:AVMediaTypeMuxed]) continue;
      [seen addObject:d.uniqueID];
      [out addObject:d];
    }
  };
  NSMutableArray* types = [NSMutableArray arrayWithObject:AVCaptureDeviceTypeBuiltInWideAngleCamera];
  if (@available(macOS 14.0, *)) {
    [types addObject:AVCaptureDeviceTypeExternal];
    [types addObject:AVCaptureDeviceTypeContinuityCamera];
  } else {
    [types addObject:AVCaptureDeviceTypeExternalUnknown];
  }
  for (AVMediaType mt in @[AVMediaTypeVideo, AVMediaTypeMuxed]) {
    @try {
      AVCaptureDeviceDiscoverySession* s =
          [AVCaptureDeviceDiscoverySession discoverySessionWithDeviceTypes:types
                                                                 mediaType:mt
                                                                  position:AVCaptureDevicePositionUnspecified];
      add(s.devices);
    } @catch (NSException* ex) {
      (void)ex;
      /* a device that throws : skip this list, the next ones may still work */
    }
  }
  @try {
    add([AVCaptureDevice devicesWithMediaType:AVMediaTypeMuxed]);
    add([AVCaptureDevice devicesWithMediaType:AVMediaTypeVideo]);
  } @catch (NSException* ex) {
    (void)ex;
  }
  return out;
}

// ── One capture ─────────────────────────────────────────────────────────────

enum State { kStarting = 0, kRunning = 1, kMissing = 2, kDenied = 3, kFailed = 4, kGone = 5 };

struct Cap {
  std::mutex m;
  std::vector<uint8_t> front; // the newest frame, RGBA, top row first (under m)
  std::vector<uint8_t> back;  // the one being filled (capture queue only)
  std::vector<uint8_t> scaled;
  int w = 0, h = 0;           // front's size (under m)
  int srcW = 0, srcH = 0;     // what the device sends
  uint64_t seq = 0;           // under m
  std::atomic<int> state{kStarting};
  std::atomic<int> maxSide{0};
  std::atomic<double> lastAt{0};
  std::string error;          // under m
};

@interface OpsiaCaptureDelegate : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate>
- (instancetype)initWithCap:(std::shared_ptr<Cap>)cap;
@end

@implementation OpsiaCaptureDelegate {
  std::shared_ptr<Cap> _cap;
}
- (instancetype)initWithCap:(std::shared_ptr<Cap>)cap {
  if ((self = [super init])) _cap = cap;
  return self;
}
- (void)captureOutput:(AVCaptureOutput*)output
    didOutputSampleBuffer:(CMSampleBufferRef)sample
           fromConnection:(AVCaptureConnection*)connection {
  Cap* c = _cap.get();
  CVImageBufferRef pb = CMSampleBufferGetImageBuffer(sample);
  if (!pb || CVPixelBufferGetPixelFormatType(pb) != kCVPixelFormatType_32BGRA) return;
  if (CVPixelBufferLockBaseAddress(pb, kCVPixelBufferLock_ReadOnly) != kCVReturnSuccess) return;
  const size_t w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb);
  void* base = CVPixelBufferGetBaseAddress(pb);
  if (base && w > 0 && h > 0) {
    vImage_Buffer src = {base, (vImagePixelCount)h, (vImagePixelCount)w, CVPixelBufferGetBytesPerRow(pb)};
    // A size cap : the long side at most maxSide, aspect kept (an iPhone turns
    // between portrait and landscape, so the cap applies per frame).
    size_t ow = w, oh = h;
    const int cap = c->maxSide.load();
    const size_t longSide = std::max(w, h);
    if (cap > 0 && longSide > (size_t)cap) {
      const double k = (double)cap / (double)longSide;
      ow = std::max<size_t>(1, (size_t)std::lround(w * k));
      oh = std::max<size_t>(1, (size_t)std::lround(h * k));
    }
    vImage_Buffer from = src;
    bool ok = true;
    if (ow != w || oh != h) {
      c->scaled.resize(ow * oh * 4);
      vImage_Buffer dst = {c->scaled.data(), (vImagePixelCount)oh, (vImagePixelCount)ow, ow * 4};
      ok = vImageScale_ARGB8888(&src, &dst, NULL, kvImageNoFlags) == kvImageNoError;
      from = dst;
    }
    if (ok) {
      c->back.resize(ow * oh * 4);
      vImage_Buffer out = {c->back.data(), (vImagePixelCount)oh, (vImagePixelCount)ow, ow * 4};
      const uint8_t bgraToRgba[4] = {2, 1, 0, 3};
      if (vImagePermuteChannels_ARGB8888(&from, &out, bgraToRgba, kvImageNoFlags) == kvImageNoError) {
        std::lock_guard<std::mutex> lock(c->m);
        c->front.swap(c->back);
        c->w = (int)ow;
        c->h = (int)oh;
        c->srcW = (int)w;
        c->srcH = (int)h;
        c->seq++;
      }
    }
    c->lastAt = [NSDate timeIntervalSinceReferenceDate];
    // Only from starting : a disconnect or an error said already stays said.
    int starting = kStarting;
    c->state.compare_exchange_strong(starting, kRunning);
  }
  CVPixelBufferUnlockBaseAddress(pb, kCVPixelBufferLock_ReadOnly);
}
@end

struct Capture {
  std::shared_ptr<Cap> cap = std::make_shared<Cap>();
  AVCaptureSession* session = nil;
  AVCaptureDevice* device = nil;
  OpsiaCaptureDelegate* delegate = nil;
  dispatch_queue_t sessionQueue = nil;
  dispatch_queue_t frameQueue = nil;
  id disconnectObserver = nil;
  id errorObserver = nil;
};

static std::map<int, std::unique_ptr<Capture>> g_caps;
static int g_next = 1;

static void Fail(Cap* c, int state, NSString* why) {
  std::lock_guard<std::mutex> lock(c->m);
  c->error = why ? std::string(why.UTF8String ?: "") : std::string();
  c->state = state;
}

// Configure and start, on the capture's own queue (startRunning blocks).
static void StartOn(Capture* k, NSString* uid) {
  std::shared_ptr<Cap> cap = k->cap;
  AVCaptureDevice* device = nil;
  for (AVCaptureDevice* d in Devices())
    if ([d.uniqueID isEqualToString:uid]) device = d;
  if (!device) {
    Fail(cap.get(), kMissing, @"not connected");
    return;
  }
  AVAuthorizationStatus auth = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
  if (auth == AVAuthorizationStatusDenied || auth == AVAuthorizationStatusRestricted) {
    Fail(cap.get(), kDenied, @"camera access denied");
    return;
  }
  NSError* err = nil;
  AVCaptureDeviceInput* input = [AVCaptureDeviceInput deviceInputWithDevice:device error:&err];
  if (!input) {
    const bool refused = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo] == AVAuthorizationStatusDenied;
    Fail(cap.get(), refused ? kDenied : kFailed, err.localizedDescription ?: @"the device would not open");
    return;
  }
  AVCaptureSession* session = [[AVCaptureSession alloc] init];
  [session beginConfiguration];
  if (![session canAddInput:input]) {
    [session commitConfiguration];
    Fail(cap.get(), kFailed, @"the device is in use");
    return;
  }
  [session addInput:input];
  AVCaptureVideoDataOutput* output = [[AVCaptureVideoDataOutput alloc] init];
  output.videoSettings = @{(__bridge NSString*)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA)};
  // Latency first : a frame that arrives while the last is still being handled
  // is dropped, never queued.
  output.alwaysDiscardsLateVideoFrames = YES;
  [output setSampleBufferDelegate:k->delegate queue:k->frameQueue];
  if (![session canAddOutput:output]) {
    [session commitConfiguration];
    Fail(cap.get(), kFailed, @"no video output for this device");
    return;
  }
  [session addOutput:output];
  [session commitConfiguration];
  k->session = session;
  k->device = device;
  // Unplugged, or the session broke : say so, the preload opens it again.
  k->disconnectObserver = [[NSNotificationCenter defaultCenter]
      addObserverForName:AVCaptureDeviceWasDisconnectedNotification
                  object:device
                   queue:nil
              usingBlock:^(NSNotification* note) {
                (void)note;
                Fail(cap.get(), kGone, @"disconnected");
              }];
  k->errorObserver = [[NSNotificationCenter defaultCenter]
      addObserverForName:AVCaptureSessionRuntimeErrorNotification
                  object:session
                   queue:nil
              usingBlock:^(NSNotification* n) {
                NSError* e = n.userInfo[AVCaptureSessionErrorKey];
                Fail(cap.get(), kGone, e.localizedDescription ?: @"the capture stopped");
              }];
  [session startRunning];
  if (!session.running && cap->state.load() == kStarting) Fail(cap.get(), kFailed, @"the capture did not start");
}

static void StopCapture(std::unique_ptr<Capture> k) {
  // Stop on the session queue, after any start still in flight (it registers
  // the observers) : the Capture, and its delegate holding the frame store, live
  // until then.
  Capture* raw = k.release();
  dispatch_async(raw->sessionQueue, ^{
    @autoreleasepool {
      if (raw->disconnectObserver) [[NSNotificationCenter defaultCenter] removeObserver:raw->disconnectObserver];
      if (raw->errorObserver) [[NSNotificationCenter defaultCenter] removeObserver:raw->errorObserver];
      raw->disconnectObserver = nil;
      raw->errorObserver = nil;
      if (raw->session) {
        for (AVCaptureOutput* o in raw->session.outputs)
          if ([o isKindOfClass:[AVCaptureVideoDataOutput class]])
            [(AVCaptureVideoDataOutput*)o setSampleBufferDelegate:nil queue:NULL];
        [raw->session stopRunning];
      }
      raw->session = nil;
      raw->device = nil;
      delete raw;
    }
  });
}

// ── N-API ───────────────────────────────────────────────────────────────────

// enable() : opt in to screen-capture devices (an iPhone appears about a second later).
static Napi::Value EnableJs(const Napi::CallbackInfo& info) {
  @autoreleasepool {
    Enable();
  }
  return info.Env().Undefined();
}

// list() → [{ id, name, model, muxed }]
static Napi::Value List(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array arr = Napi::Array::New(env);
  @autoreleasepool {
    uint32_t i = 0;
    for (AVCaptureDevice* d in Devices()) {
      if (d.suspended) continue;
      Napi::Object o = Napi::Object::New(env);
      o.Set("id", Napi::String::New(env, d.uniqueID.UTF8String ?: ""));
      o.Set("name", Napi::String::New(env, d.localizedName.UTF8String ?: ""));
      o.Set("model", Napi::String::New(env, d.modelID.UTF8String ?: ""));
      o.Set("muxed", Napi::Boolean::New(env, [d hasMediaType:AVMediaTypeMuxed] && ![d hasMediaType:AVMediaTypeVideo]));
      arr.Set(i++, o);
    }
  }
  return arr;
}

// open(id, maxSide) → handle. Starts in the background : poll frame(handle).
static Napi::Value Open(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) return env.Null();
  std::string id = info[0].As<Napi::String>().Utf8Value();
  int maxSide = info.Length() > 1 && info[1].IsNumber() ? info[1].As<Napi::Number>().Int32Value() : 0;
  @autoreleasepool {
    auto k = std::make_unique<Capture>();
    k->cap->maxSide = std::max(0, maxSide);
    k->delegate = [[OpsiaCaptureDelegate alloc] initWithCap:k->cap];
    k->sessionQueue = dispatch_queue_create("opsia.avcapture.session", DISPATCH_QUEUE_SERIAL);
    k->frameQueue = dispatch_queue_create("opsia.avcapture.frames", DISPATCH_QUEUE_SERIAL);
    Capture* raw = k.get();
    NSString* uid = [NSString stringWithUTF8String:id.c_str()];
    dispatch_async(raw->sessionQueue, ^{
      @autoreleasepool {
        StartOn(raw, uid);
      }
    });
    const int h = g_next++;
    g_caps[h] = std::move(k);
    return Napi::Number::New(env, h);
  }
}

static const char* StateName(int s) {
  switch (s) {
    case kRunning: return "running";
    case kMissing: return "missing";
    case kDenied: return "denied";
    case kFailed: return "failed";
    case kGone: return "gone";
    default: return "starting";
  }
}

// frame(handle) → { state, w, h, srcW, srcH, seq, idle, error } : what is there
// to copy, without copying. idle = seconds since the last frame (-1 : none yet).
static Napi::Value Frame(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) return env.Null();
  auto it = g_caps.find(info[0].As<Napi::Number>().Int32Value());
  if (it == g_caps.end()) return env.Null();
  Capture* k = it->second.get();
  Cap* c = k->cap.get();
  // Looked at directly too, not only through the notifications : an unplugged
  // device must never sit there as a dead "running" capture.
  @autoreleasepool {
    const int st = c->state.load();
    AVCaptureDevice* d = k->device;
    AVCaptureSession* s = k->session;
    if (st == kRunning || st == kStarting) {
      if (d && !d.connected) Fail(c, kGone, @"disconnected");
      else if (st == kRunning && s && !s.running) Fail(c, kGone, @"the capture stopped");
    }
  }
  Napi::Object o = Napi::Object::New(env);
  std::lock_guard<std::mutex> lock(c->m);
  o.Set("state", Napi::String::New(env, StateName(c->state.load())));
  o.Set("w", Napi::Number::New(env, c->w));
  o.Set("h", Napi::Number::New(env, c->h));
  o.Set("srcW", Napi::Number::New(env, c->srcW));
  o.Set("srcH", Napi::Number::New(env, c->srcH));
  o.Set("seq", Napi::Number::New(env, (double)c->seq));
  const double last = c->lastAt.load();
  o.Set("idle", Napi::Number::New(env, last > 0 ? [NSDate timeIntervalSinceReferenceDate] - last : -1));
  o.Set("error", Napi::String::New(env, c->error));
  return o;
}

// copy(handle, arrayBuffer, w, h) → the seq copied, or 0 (no frame, or the
// newest frame is not w×h : ask frame() for the size again). The size, not only
// the byte count : a phone turned between frame() and copy() keeps its bytes
// (887×1920 = 1920×887) and the frame would go out labelled with the old shape.
static Napi::Value Copy(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4 || !info[0].IsNumber() || !info[1].IsArrayBuffer() || !info[2].IsNumber() || !info[3].IsNumber())
    return Napi::Number::New(env, 0);
  auto it = g_caps.find(info[0].As<Napi::Number>().Int32Value());
  if (it == g_caps.end()) return Napi::Number::New(env, 0);
  Napi::ArrayBuffer ab = info[1].As<Napi::ArrayBuffer>();
  const int ew = info[2].As<Napi::Number>().Int32Value(), eh = info[3].As<Napi::Number>().Int32Value();
  Cap* c = it->second->cap.get();
  std::lock_guard<std::mutex> lock(c->m);
  const size_t bytes = (size_t)c->w * (size_t)c->h * 4;
  if (!c->seq || bytes == 0 || c->w != ew || c->h != eh || ab.ByteLength() != bytes || c->front.size() < bytes)
    return Napi::Number::New(env, 0);
  std::memcpy(ab.Data(), c->front.data(), bytes);
  return Napi::Number::New(env, (double)c->seq);
}

// setMaxSide(handle, px) : the size cap, from the next frame (0 : none).
static Napi::Value SetMaxSide(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) return env.Undefined();
  auto it = g_caps.find(info[0].As<Napi::Number>().Int32Value());
  if (it != g_caps.end()) it->second->cap->maxSide = std::max(0, info[1].As<Napi::Number>().Int32Value());
  return env.Undefined();
}

// close(handle)
static Napi::Value Close(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) return env.Undefined();
  auto it = g_caps.find(info[0].As<Napi::Number>().Int32Value());
  if (it == g_caps.end()) return env.Undefined();
  std::unique_ptr<Capture> k = std::move(it->second);
  g_caps.erase(it);
  @autoreleasepool {
    StopCapture(std::move(k));
  }
  return env.Undefined();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("enable", Napi::Function::New(env, EnableJs));
  exports.Set("list", Napi::Function::New(env, List));
  exports.Set("open", Napi::Function::New(env, Open));
  exports.Set("frame", Napi::Function::New(env, Frame));
  exports.Set("copy", Napi::Function::New(env, Copy));
  exports.Set("setMaxSide", Napi::Function::New(env, SetMaxSide));
  exports.Set("close", Napi::Function::New(env, Close));
  return exports;
}

NODE_API_MODULE(avcapture, Init)
