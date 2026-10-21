// Ableton Link for Palinopsia : one Link instance for the whole app, in the main
// process (src/main/link.ts). Polled, never calling back : state() is read about
// 30 times a second and the page carries the beat on between two reads, so no
// thread ever touches JavaScript. Link itself runs its own network threads.
//
//   enable(on)            join or leave the Link session on this network
//   startStopSync(on)     share play and stop with the peers that share theirs
//   state(quantum)        { enabled, peers, tempo, beat, phase, startStop,
//                           playing, playBeat } right now
//   setTempo(bpm)         propose a tempo to every peer
//   setPlaying(on, q)     propose play or stop to every peer (start / stop sync)
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

double quantumArg(const Napi::CallbackInfo& info, size_t i)
{
  double quantum = info.Length() > i && info[i].IsNumber() ? info[i].ToNumber().DoubleValue() : 4.0;
  return quantum >= 1.0 && quantum <= 64.0 ? quantum : 4.0;
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

// Start / stop sync : off by default, as in Live. While it is off, play and
// stop stay each app's own and nothing below is shared.
Napi::Value StartStopSync(const Napi::CallbackInfo& info)
{
  const bool on = info.Length() > 0 && info[0].ToBoolean().Value();
  try
  {
    link().enableStartStopSync(on);
    return Napi::Boolean::New(info.Env(), link().isStartStopSyncEnabled());
  }
  catch (...)
  {
    return Napi::Boolean::New(info.Env(), false);
  }
}

Napi::Value State(const Napi::CallbackInfo& info)
{
  Napi::Env env = info.Env();
  const double quantum = quantumArg(info, 0);
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
    // The session's transport (only shared while start / stop sync is on) :
    // playing or not, and the beat it was set at, on the same count as `beat`.
    // A play starts on the first bar from there (Live and Link's own examples
    // put beat 0 on it : the count before it is negative).
    o.Set("startStop", Napi::Boolean::New(env, l.isStartStopSyncEnabled()));
    o.Set("playing", Napi::Boolean::New(env, st.isPlaying()));
    o.Set("playBeat", Napi::Number::New(env, st.beatAtTime(st.timeForIsPlaying(), quantum)));
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

// Play or stop, proposed to every peer (start / stop sync on). A play maps
// beat 0 to now as Link asks : with other apps, to the first bar from now,
// so everyone starts there in phase (the count moves by whole bars); alone,
// to now, and it starts at once. Asking for what already is changes nothing.
Napi::Value SetPlaying(const Napi::CallbackInfo& info)
{
  Napi::Env env = info.Env();
  const bool on = info.Length() > 0 && info[0].ToBoolean().Value();
  const double quantum = quantumArg(info, 1);
  try
  {
    auto& l = link();
    // without start / stop sync a play would only re-map the beat
    if (!l.isStartStopSyncEnabled())
      return Napi::Boolean::New(env, false);
    auto st = l.captureAppSessionState();
    if (st.isPlaying() != on)
    {
      const auto now = l.clock().micros();
      if (on)
        st.setIsPlayingAndRequestBeatAtTime(true, now, 0.0, quantum);
      else
        st.setIsPlaying(false, now);
      l.commitAppSessionState(st);
    }
    return Napi::Boolean::New(env, st.isPlaying());
  }
  catch (...)
  {
    return Napi::Boolean::New(env, false);
  }
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
  exports.Set("startStopSync", Napi::Function::New(env, StartStopSync));
  exports.Set("setTempo", Napi::Function::New(env, SetTempo));
  exports.Set("setPlaying", Napi::Function::New(env, SetPlaying));
  exports.Set("close", Napi::Function::New(env, Close));
  return exports;
}

} // namespace

NODE_API_MODULE(link, Init)
