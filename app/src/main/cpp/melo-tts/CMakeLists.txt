cmake_minimum_required(VERSION 3.22)
project(avatar_melo_tts LANGUAGES CXX)

add_library(avatar_melo_tts SHARED melo_speech.cpp)
target_compile_features(avatar_melo_tts PRIVATE cxx_std_17)
target_include_directories(avatar_melo_tts PRIVATE "${ONNXRUNTIME_INCLUDE}")
target_link_libraries(avatar_melo_tts PRIVATE dl)
target_link_options(avatar_melo_tts PRIVATE
    "-Wl,-z,max-page-size=16384" "-Wl,-z,common-page-size=16384")
