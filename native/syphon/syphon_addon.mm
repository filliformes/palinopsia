// Palinopsia Syphon sender : a minimal N-API addon over the Syphon framework's
// SyphonMetalServer (macOS), the twin of native/spout. The app publishes its
// composite as a Syphon source (Resolume, MadMapper, TouchDesigner, VDMX, OBS…)
// straight from the readback pixels. Metal needs no window, so it runs headless
// in the Electron main process. Syphon framework : BSD (Syphon/Syphon-Framework),
// built by build.sh and shipped next to this .node.

#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#import <Syphon/SyphonMetalServer.h>
#include <napi.h>
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

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("open", Napi::Function::New(env, Open));
  exports.Set("send", Napi::Function::New(env, Send));
  exports.Set("close", Napi::Function::New(env, Close));
  exports.Set("topDown", Napi::Boolean::New(env, true)); // understands send(…, topDown)
  return exports;
}

NODE_API_MODULE(syphon, Init)
