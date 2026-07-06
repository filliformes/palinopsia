{
  "targets": [
    {
      "target_name": "spout",
      "sources": [
        "spout_addon.cpp",
        "sdk/SpoutDX.cpp",
        "sdk/SpoutSenderNames.cpp",
        "sdk/SpoutSharedMemory.cpp",
        "sdk/SpoutFrameCount.cpp",
        "sdk/SpoutUtils.cpp",
        "sdk/SpoutDirectX.cpp",
        "sdk/SpoutCopy.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "sdk"
      ],
      "libraries": [ "d3d11.lib", "dxgi.lib" ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS", "_CRT_SECURE_NO_WARNINGS", "UNICODE", "_UNICODE" ],
      "msvs_settings": {
        "VCCLCompilerTool": { "ExceptionHandling": 1 }
      }
    }
  ]
}
