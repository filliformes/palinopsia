{
  "targets": [
    {
      "target_name": "link",
      "sources": [ "link_addon.cpp" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "sdk/link/include",
        "sdk/asio/include"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "ASIO_STANDALONE=1",
        "ASIO_NO_TYPEID=1",
        "ASIO_VERSION_NAMESPACE=link_asio_1_38_2"
      ],
      "conditions": [
        [ "OS=='win'", {
          # Electron's common.gypi builds addons with _HAS_EXCEPTIONS=0 : the
          # standard library then aborts the process where it would throw, and
          # the catch (...) around every Link call never sees it. Link and asio
          # use exceptions, so turn the library's back on (as node-addon-api's
          # except.gypi does), with /EHsc (ExceptionHandling 1) below.
          "defines!": [ "_HAS_EXCEPTIONS=0" ],
          "defines": [
            "_HAS_EXCEPTIONS=1",
            "LINK_PLATFORM_WINDOWS=1",
            "INCL_EXTRA_HTON_FUNCTIONS=1",
            "_WIN32_WINNT=0x0601",
            "NOMINMAX",
            "WIN32_LEAN_AND_MEAN",
            "_CRT_SECURE_NO_WARNINGS"
          ],
          "libraries": [ "ws2_32.lib", "iphlpapi.lib", "winmm.lib" ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": [ "/std:c++20", "/bigobj" ]
            }
          }
        } ],
        [ "OS=='mac'", {
          "defines": [ "LINK_PLATFORM_UNIX=1", "LINK_PLATFORM_MACOSX=1" ],
          "xcode_settings": {
            "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "12.0"
          }
        } ],
        [ "OS=='linux'", {
          "defines": [ "LINK_PLATFORM_UNIX=1", "LINK_PLATFORM_LINUX=1" ],
          "cflags_cc": [ "-std=c++20", "-fexceptions" ],
          "libraries": [ "-latomic", "-lpthread" ]
        } ]
      ]
    }
  ]
}
