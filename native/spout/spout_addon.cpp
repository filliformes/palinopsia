// Palinopsia Spout sender — a minimal N-API addon over Spout2's spoutDX (DX11)
// class, so the app can publish its composite as a Spout source (Resolume, OBS,
// etc.) directly from the readback pixels. DX11 needs no OpenGL context, so it
// runs headless in the Electron main process. Vendored Spout SDK: leadedge/Spout2.

#include <napi.h>
#include <vector>
#include "sdk/SpoutDX.h"

static spoutDX* g_sender = nullptr;
static std::vector<unsigned char> g_flip;

// open(name) → bool. Creates the DX11 sender.
Napi::Value Open(const Napi::CallbackInfo& info) {
  std::string name = info[0].As<Napi::String>().Utf8Value();
  if (!g_sender) g_sender = new spoutDX();
  bool ok = g_sender->OpenDirectX11();
  if (ok) {
    // Match our RGBA8 readback so channels aren't swapped.
    g_sender->SetSenderFormat(DXGI_FORMAT_R8G8B8A8_UNORM);
    g_sender->SetSenderName(name.c_str());
  }
  return Napi::Boolean::New(info.Env(), ok);
}

// send(buffer, width, height). Buffer is RGBA8, GL bottom-up → flipped here.
Napi::Value Send(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_sender) return env.Undefined();
  Napi::Buffer<unsigned char> buf = info[0].As<Napi::Buffer<unsigned char>>();
  uint32_t w = info[1].As<Napi::Number>().Uint32Value();
  uint32_t h = info[2].As<Napi::Number>().Uint32Value();
  const size_t stride = (size_t)w * 4;
  if (buf.Length() < stride * h) return env.Undefined();
  const unsigned char* src = buf.Data();
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

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("open", Napi::Function::New(env, Open));
  exports.Set("send", Napi::Function::New(env, Send));
  exports.Set("close", Napi::Function::New(env, Close));
  return exports;
}

NODE_API_MODULE(spout, Init)
