{
  "variables": {
    "df": "sdk/dataflou",
    "df_defines": [
      "ASIO_STANDALONE=1",
      "ASIO_NO_DEPRECATED=1",
      "ASIO_NO_TYPEID=1"
    ],
    "df_win_defines": [
      "NOMINMAX",
      "WIN32_LEAN_AND_MEAN",
      "_WIN32_WINNT=0x0A00",
      "_USE_MATH_DEFINES",
      "_CRT_SECURE_NO_WARNINGS",
      "_HAS_EXCEPTIONS=1"
    ]
  },
  "target_defaults": {
    "defines": [ "<@(df_defines)" ],
    "include_dirs": [
      "<(df)/include",
      "<(df)/src/pal",
      "<(df)/capi/include",
      "sdk/etl/include",
      "sdk/qcbor/inc",
      "sdk/cjson",
      "sdk/asio/asio/include",
      "sdk/mdns"
    ],
    "conditions": [
      [ "OS=='win'", {
        # Electron's common.gypi builds addons with _HAS_EXCEPTIONS=0; asio and the
        # standard library throw (the node's thread catches) : back on, with /EHsc.
        "defines!": [ "_HAS_EXCEPTIONS=0" ],
        "defines": [ "<@(df_win_defines)" ],
        "msvs_disabled_warnings": [ 4244, 4267, 4996, 4805, 4146, 4018 ],
        "msvs_settings": {
          "VCCLCompilerTool": {
            "ExceptionHandling": 1,
            # (cJSON and QCBOR are C : /std:c++latest is a warning there, not an error)
            "AdditionalOptions": [ "/std:c++latest", "/utf-8", "/bigobj" ],
            "AdditionalOptions!": [ "-std:c++20", "/std:c++20", "/std:c++17", "-std:c++17" ]
          }
        }
      } ],
      [ "OS=='mac'", {
        "xcode_settings": {
          "CLANG_CXX_LANGUAGE_STANDARD": "c++2b",
          "CLANG_CXX_LIBRARY": "libc++",
          "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
          "MACOSX_DEPLOYMENT_TARGET": "13.3"
        }
      } ],
      [ "OS=='linux'", {
        "cflags_cc!": [ "-std=gnu++17", "-std=gnu++20", "-fno-exceptions" ],
        "cflags_cc": [ "-std=c++23", "-fexceptions" ],
        "cflags": [ "-fPIC" ]
      } ]
    ]
  },
  "targets": [
    {
      # (one library each : the core and the C interface both have a node.cpp)
      "target_name": "df_core",
      "type": "static_library",
      "sources": [
        "<(df)/src/core/param.cpp",
        "<(df)/src/core/world_view.cpp",
        "<(df)/src/core/protocol.cpp",
        "<(df)/src/core/config_loader.cpp",
        "<(df)/src/core/node.cpp",
        "<(df)/src/core/node_peers.cpp",
        "<(df)/src/core/node_messages.cpp",
        "<(df)/src/core/node_storage.cpp",
        "<(df)/src/core/node_connections.cpp",
        "<(df)/src/core/node_populations.cpp",
        "<(df)/src/core/node_picks.cpp",
        "<(df)/src/core/node_signals.cpp",
        "<(df)/src/core/node_instances.cpp",
        "<(df)/src/core/node_streams.cpp",
        "<(df)/src/core/node_clock.cpp",
        "<(df)/src/core/stream_codec.cpp",
        "<(df)/src/core/memory_config.cpp"
      ]
    },
    {
      "target_name": "df_desktop",
      "type": "static_library",
      "sources": [
        "<(df)/src/pal/desktop/tcp_asio.cpp",
        "<(df)/src/pal/desktop/udp_asio.cpp",
        "<(df)/src/pal/desktop/mdns_mjansson.cpp",
        "<(df)/src/pal/desktop/clock_std.cpp",
        "<(df)/src/pal/desktop/storage_file.cpp",
        "<(df)/src/pal/desktop/platform_desktop.cpp",
        "<(df)/src/pal/desktop/world_json.cpp",
        "<(df)/src/pal/desktop/config_json.cpp",
        "<(df)/src/pal/desktop/state_json.cpp"
      ],
      "conditions": [
        [ "OS=='mac'", { "sources": [ "<(df)/src/pal/apple/mdns_dnssd.cpp" ] } ]
      ]
    },
    {
      "target_name": "df_capi",
      "type": "static_library",
      "sources": [
        "<(df)/capi/src/node.cpp",
        "<(df)/capi/src/params.cpp",
        "<(df)/capi/src/world.cpp",
        "<(df)/capi/src/connections.cpp",
        "<(df)/capi/src/populations.cpp",
        "<(df)/capi/src/state.cpp",
        "<(df)/capi/src/mesh.cpp"
      ]
    },
    {
      "target_name": "df_libs",
      "type": "static_library",
      "sources": [
        "sdk/qcbor/src/UsefulBuf.c",
        "sdk/qcbor/src/ieee754.c",
        "sdk/qcbor/src/qcbor_decode.c",
        "sdk/qcbor/src/qcbor_encode.c",
        "sdk/qcbor/src/qcbor_err_to_str.c",
        "sdk/cjson/cJSON.c"
      ]
    },
    {
      "target_name": "dataflou",
      "sources": [ "df_addon.cc" ],
      # (node-gyp's addon defaults turn C++ exceptions off on macOS for the module
      # itself, after target_defaults : the addon catches the core's, so on again here)
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "OTHER_CPLUSPLUSFLAGS": [ "-fexceptions" ]
      },
      "dependencies": [ "df_capi", "df_desktop", "df_core", "df_libs" ],
      "conditions": [
        [ "OS=='win'", {
          "libraries": [ "ws2_32.lib", "iphlpapi.lib", "mswsock.lib", "winmm.lib", "bcrypt.lib" ]
        } ],
        [ "OS=='linux'", {
          "libraries": [ "-lpthread" ]
        } ]
      ]
    }
  ]
}
