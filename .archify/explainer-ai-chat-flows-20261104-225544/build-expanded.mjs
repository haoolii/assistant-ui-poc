import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const directory = dirname(fileURLToPath(import.meta.url));
const source = join(directory, 'ai-chat-flows.html');
const output = join(directory, 'ai-chat-flows-expanded.html');
const marker = '<style id="expanded-flow-overrides">';

let html = readFileSync(source, 'utf8');

if (!html.includes(marker)) {
  html = html.replace(
    '</head>',
    `${marker}
button[data-open-diagram], .diagram-actions { display: none !important; }
.diagram-preview { pointer-events: none !important; cursor: default !important; }
</style>
</head>`,
  );
}

writeFileSync(output, html);
