"""Equirectangular Earth map for the eclipse model (Natural Earth 50m via cartopy).

Usage:  python make_earth_texture.py [output.jpg]   (default: ../textures/earth.jpg)
"""
import os, sys, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs, cartopy.feature as cf
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "textures", "earth.jpg")
fig = plt.figure(figsize=(20.48, 10.24), dpi=100)
ax = fig.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree())
ax.set_global(); ax.axis("off")
fig.patch.set_facecolor("#1d3d63"); ax.set_facecolor("#1d3d63")
ax.add_feature(cf.NaturalEarthFeature("physical", "land", "50m"), facecolor="#8a9a6e", edgecolor="none")
ax.add_feature(cf.NaturalEarthFeature("physical", "glaciated_areas", "50m"), facecolor="#e6eaee", edgecolor="none")
ax.add_feature(cf.NaturalEarthFeature("physical", "antarctic_ice_shelves_polys", "50m"), facecolor="#e6eaee", edgecolor="none")
ax.add_feature(cf.NaturalEarthFeature("physical", "lakes", "50m"), facecolor="#1d3d63", edgecolor="none")
ax.add_feature(cf.NaturalEarthFeature("physical", "coastline", "50m"), facecolor="none", edgecolor="#c9d6b0", linewidth=0.5)
ax.add_feature(cf.NaturalEarthFeature("cultural", "admin_0_boundary_lines_land", "50m"), facecolor="none", edgecolor="#5d6b4a", linewidth=0.35)
fig.savefig(out, dpi=100, pil_kwargs={"quality": 82})
