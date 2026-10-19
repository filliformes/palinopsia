// Ableton Link for Palinopsia : one Link instance for the whole app, in the main
// process (src/main/link.ts). Polled, never calling back : state() is read about
// 30 times a second and the page carries the beat on between two reads, so no
// thread ever touches JavaScript. Link itself runs its own network threads.
//
//   enable(on)            join or leave the Link session on this network
//   state(quantum)        { enabled, peers, tempo, beat, phase } right now
//   setTempo(bpm)         propose a tempo to every peer
//   close()               leave and stop Link's threads (app quit)
//
// Link (GPL-2.0-or-later) and asio (Boost) are vendored under sdk/.

#include <napi.h>

#include <ableton/Link.hpp>

#include <memory>

namespace {

std::unique_ptr<ableton::Link> gLink;

ableton::Link& link()
{
  if (!gLink)
    gLink = std::make_unique<ableton::Link>(120.0);
  return *gLink;
}

Napi::Value Enable(const Napi::CallbackInfo& info)
{
  const bool on = info.Length() > 0 && info[0].ToBoolean().Value();
  try
  {
    link().enable(on);
    return Napi::Boolean::New(info.Env(), link().isEnabled());
  }
  catch (...)
  {
    return Napi::Boolean::New(info.Env(), false);
  }
}

Napi::Value State(const Napi::CallbackInfo& info)
{
  Napi::Env env = info.Env();
  double quantum = info.Length() > 0 && info[0].IsNumber() ? info[0].ToNumber().DoubleValue() : 4.0;
  if (!(quantum >= 1.0 && quantum <= 64.0))
    quantum = 4.0;
  Napi::Object o = Napi::Object::New(env);
  try
  {
    auto& l = link();
    const auto now = l.clock().micros();
    const auto st = l.captureAppSessionState();
    o.Set("enabled", Napi::Boolean::New(env, l.isEnabled()));
    o.Set("peers", Napi::Number::New(env, static_cast<double>(l.numPeers())));
    o.Set("tempo", Napi::Number::New(env, st.tempo()));
    o.Set("beat", Napi::Number::New(env, st.beatAtTime(now, quantum)));
    o.Set("phase", Napi::Number::New(env, st.phaseAtTime(now, quantum)));
  }
  catch (...)
  {
    o.Set("enabled", Napi::Boolean::New(env, false));
  }
  return o;
}

Napi::Value SetTempo(const Napi::CallbackInfo& info)
{
  if (info.Length() < 1 || !info[0].IsNumber())
    return info.Env().Undefined();
  const double bpm = info[0].ToNumber().DoubleValue();
  if (!(bpm >= 20.0 && bpm <= 999.0))
    return info.Env().Undefined();
  try
  {
    auto& l = link();
    auto st = l.captureAppSessionState();
    st.setTempo(bpm, l.clock().micros());
    l.commitAppSessionState(st);
  }
  catch (...)
  {
  }
  return info.Env().Undefined();
}

Napi::Value Close(const Napi::CallbackInfo& info)
{
  try
  {
    if (gLink)
      gLink->enable(false);
    gLink.reset();
  }
  catch (...)
  {
  }
  return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
  exports.Set("enable", Napi::Function::New(env, Enable));
  exports.Set("state", Napi::Function::New(env, State));
  exports.Set("setTempo", Napi::Function::New(env, SetTempo));
  exports.Set("close", Napi::Function::New(env, Close));
  return exports;
}

} // namespace

NODE_API_MODULE(link, Init)
