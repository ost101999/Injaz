
const fs = require('fs');
const path = 'App.tsx';
let lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);
// Line numbers are 1-indexed in the view, so line 4355 is index 4354
// However, the file might have shifted.
// I'll look for the pattern around 4350-4360
for (let i = 4350; i < 4360; i++) {
    if (lines[i] && lines[i].includes("setInlineEditText('');") && lines[i+1].trim() === "" && lines[i+2].trim() === "}") {
        lines[i+1] = "                                                                                                                     }, 100);";
        console.log(`Fixed at line ${i+2}`);
        break;
    }
}
fs.writeFileSync(path, lines.join('\n'));
