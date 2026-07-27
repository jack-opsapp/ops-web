# External intake file fixtures

The attachment security tests build tiny, deterministic files in memory. The
corpus contains no customer data, personal information, or copyrighted
documents.

The tests generate:

- raster images with `sharp`;
- PDFs with `pdf-lib`;
- OOXML ZIP and legacy Office compound containers with `cfb`;
- plain text, CSV, DXF, and deliberately malformed byte sequences.

Purpose-built hostile cases cover active content, macros, encryption markers,
decompression ratios, type mismatches, polyglots, executables, scripts, HTML,
SVG, and corrupt images. Large-file limits are exercised with metadata or
bounded synthetic buffers rather than committed binary artifacts.
