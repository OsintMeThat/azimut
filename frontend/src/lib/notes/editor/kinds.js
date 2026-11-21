/**
 * Every kind of block the note page draws whole, loaded once in this order, which is
 * the order they are read in: a kind of block a later lot adds is one more import
 * here (`editor/blocks.js` says what a kind declares).
 */
// an infographic first: its four colons hold blocks of the kinds below, drawn as its panels
import './infographicBlock.js';
import './alignedBlock.js';
import './playedBlock.js';
import './mapBlock.js';
import './diagramBlock.js';
import './tableBlock.js';
import './tableGrid.js';
import './pictureBlock.js';
import './chartBlock.js';
import './postBlock.js';
import './breakBlocks.js';
import './ruleBlock.js';
import './htmlBlock.js';
import './includeBlock.js';
