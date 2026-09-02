const model = process.argv[2];
if (!model) throw new Error("model argument is required");

const output = (await Bun.stdin.text()).replaceAll("\r\n", "\n");
const marker = `${model}\n`;
const start = output.indexOf(marker);
if (start < 0) throw new Error(`Model not found: ${model}`);

const provider = model.split("/")[0];
const escapedProvider = provider.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rest = output.slice(start + marker.length);
const next = rest.search(new RegExp(`^${escapedProvider}/`, "m"));
const metadata = JSON.parse((next < 0 ? rest : rest.slice(0, next)).trim());
if (
  !metadata ||
  typeof metadata !== "object" ||
  !metadata.variants ||
  typeof metadata.variants !== "object"
) {
  throw new Error(`Model variants not found: ${model}`);
}

process.stdout.write(JSON.stringify(Object.keys(metadata.variants)));
