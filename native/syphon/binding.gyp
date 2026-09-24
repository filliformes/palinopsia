{
  "targets": [
    {
      "target_name": "syphon",
      "sources": [ "syphon_addon.mm" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
        [ "OS=='mac'", {
          "xcode_settings": {
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "MACOSX_DEPLOYMENT_TARGET": "11.0",
            "OTHER_CFLAGS": [ "-F<(module_root_dir)/frameworks" ],
            "OTHER_LDFLAGS": [
              "-F<(module_root_dir)/frameworks",
              "-framework", "Syphon",
              "-framework", "Metal",
              "-framework", "Foundation",
              "-Wl,-rpath,@loader_path"
            ]
          }
        } ]
      ]
    }
  ]
}
