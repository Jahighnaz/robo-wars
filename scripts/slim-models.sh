#!/bin/sh
# Slims a robot model for the web: ~5% of the triangles, 1024 px WebP textures,
# meshopt compression (about 14 MB -> 1 MB). Usage:
#   sh scripts/slim-models.sh <in.glb> <chassis>   ->  public/models/<chassis>.glb
set -e
npx -y @gltf-transform/cli@4 optimize "$1" "public/models/$2.glb" \
  --simplify-ratio 0.05 --simplify-error 0.002 --texture-size 1024 --texture-compress webp --compress meshopt
