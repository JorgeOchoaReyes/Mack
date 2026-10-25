// Renders build/icon.svg to the PNG the window and the Windows installer use.
import sharp from "sharp";

await sharp("build/icon.svg", { density: 384 }).resize(512, 512).png().toFile("build/icon.png");
console.log("wrote build/icon.png");
