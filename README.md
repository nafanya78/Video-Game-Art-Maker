# Video Game Art Maker

A local game-asset editor for AI Race Game, with AI image generation, targeted part editing, raster layers, and sprite animation.

## Run

Install Node.js 22 or newer, then run `npm install` and `npm start`. Open the local URL printed by the server (normally http://127.0.0.1:4317). The server uses the next available port if necessary.

Editing and the included sample work without an API key. For paid AI generation and masked edits, enter an OpenAI API key in the connection dialog; the key lives only in the current tab's memory. Alternatively copy `.env.example` to `.env`, set `OPENAI_API_KEY`, and restart. `.env` is ignored by Git and never served. The default image model is `gpt-image-1.5`; change `OPENAI_IMAGE_MODEL` in `.env` to a compatible GPT Image model available to your account. API access and billing are separate from using this local editor.

## Parts and layers

- Import PNG, JPEG, or WebP images, or generate a new transparent asset layer.
- Paint over wheels, bodywork, or another part with the selection tool. Recolor uses the brush color and preserves simple brightness shading. Remove part deletes selected pixels. AI edit replaces selected pixels from a prompt and preserves every fully unselected pixel exactly.
- Extract moves selected pixels from the current layer into a separate, tightly cropped layer. Move, resize, and rotate it with the transform handles. Transparency is left where the part was removed; repaint or use AI editing to fill exposed areas when needed.
- Brush, erase, opacity, visibility, naming, ordering, duplication, and undo/redo operate on layers. AI edits preserve the original as a hidden layer.
- Generated images arrive flattened. Part selection is manual; there is no automatic semantic wheel/body segmentation in this version.

## Animation and export

Duplicate a frame, edit its layers, and preview playback at 1-30 fps. Onion skin displays the previous frame. Animation is frame-by-frame: no automatic rigging, tweening, or AI motion generation.

Save an `.artmaker` project to retain all frames and layers. Changes are kept in memory until saved; closing or refreshing the tab discards unsaved work. Undo retains up to 20 complete project snapshots. Large projects can use substantial memory; the current file format supports 48 frames and 40 layers per frame.

Export the current frame as a transparent PNG, or an animation as a PNG sprite sheet and JSON frame metadata. In Godot, add the sheet to a SpriteFrames resource using "Add frames from a Sprite Sheet", match the exported columns/rows, select the used cells, and set the animation speed to the exported fps. JSON is descriptive metadata, not a native Godot resource. Each export can be scaled to 100%, 50%, or 25%.

## Verification

`npm test` runs server contract tests using a mocked provider. `npx playwright test` runs editor tests in Microsoft Edge against the running local server on port 4317, including pixel preservation outside AI selections, extraction, undo, project round-trip, sprite export, and mobile layout. No paid API requests are made by tests.

Live generation requires an API key and has not been validated without one. API implementation follows the [OpenAI image generation reference](https://developers.openai.com/api/reference/resources/images/methods/generate) and [image edit reference](https://developers.openai.com/api/reference/resources/images/methods/edit). Canvas transforms use [Konva](https://konvajs.org/docs/).

## Sample asset

`public/assets/sample-car.png` was generated with the built-in Image Generation tool. Prompt: A single polished red futuristic racing car viewed directly from above, nose pointing up, fully visible with generous transparent margins. Four black tires, ivory twin racing stripes, dark glass canopy, restrained turquoise headlight details. Crisp detailed game-ready painted 3D sprite, strong readable silhouette. Square image, truly transparent background, no ground, no cast shadow, no text, no logos, no watermark.
