
const fs = require('fs');
const path = 'App.tsx';
let content = fs.readFileSync(path, 'utf8');
const broken = "setInlineEditText('');\n                       \n                                                                                                                 }";
const fixed = "setInlineEditText('');\n                                                                                                                     }, 100);\n                                                                                                                 }";
if (content.includes(broken)) {
    content = content.replace(broken, fixed);
    fs.writeFileSync(path, content);
    console.log('Fixed successfully');
} else {
    console.log('Could not find broken pattern');
    // Try a simpler pattern
    const broken2 = "setInlineEditText('');\r\n                       \r\n                                                                                                                 }";
    if (content.includes(broken2)) {
        content = content.replace(broken2, fixed);
        fs.writeFileSync(path, content);
        console.log('Fixed successfully (Windows line endings)');
    } else {
        console.log('Pattern not found');
    }
}
