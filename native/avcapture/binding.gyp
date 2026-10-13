{
  "targets": [
    {
      "target_name": "avcapture",
      "sources": [ "avcapture_addon.mm" ],
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
            "OTHER_LDFLAGS": [
              "-framework", "AVFoundation",
              "-framework", "CoreMedia",
              "-framework", "CoreMediaIO",
              "-framework", "CoreVideo",
              "-framework", "Accelerate",
              "-framework", "Foundation"
            ]
          }
        } ]
      ]
    }
  ]
}
