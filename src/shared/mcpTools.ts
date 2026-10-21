// The tools Palinopsia offers an agent over MCP (src/main/mcp.ts serves them,
// src/renderer/src/mcp/tools.ts runs them). Shared so the list the agent reads
// and the calls the page answers can never drift apart.
//
// Addresses, the same everywhere :
//   a unit (its controls)  L1.A · L1.B · L1.fx.2 · L1.A.fx.1 · master.fx.1 ·
//                          master.vibe · master.context · master.finalizer ·
//                          bg · bg.fx.1      (layers 1-4, effects counted from 1)
//   a rack (its effects)   L1 · L1.A · L1.B · master · bg

export interface McpToolDef {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  /** true : it only reads (the client may run it without asking) */
  readOnly?: boolean
  /** true : it can remove or overwrite something (an effect, a scene, a file) */
  destructive?: boolean
}

const unit = {
  type: 'string',
  description:
    'Which unit : L1.A / L1.B (a layer\'s sources), L1.fx.2 (layer 1\'s 2nd effect), L1.A.fx.1 (an effect on source A), master.fx.1, master.vibe, master.context, master.finalizer, bg (the background source), bg.fx.1. Layers are 1-4, effects count from 1.'
}
const rack = {
  type: 'string',
  description: 'Which effect rack : L1 (the layer, after its sources mix), L1.A / L1.B (one source, before the mix), master (the whole picture), bg (the background).'
}
const values = {
  type: 'object',
  description:
    'Control name → value, in the control\'s own units (describe_shader gives the ranges) : a number for float / long, true/false for bool and event, [r,g,b,a] 0-1 for color, [x,y] for point2D. A long also takes one of its labels. Values outside the range are clamped.',
  additionalProperties: true
}

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'get_state',
    title: 'Read the composition',
    description:
      'What is playing now : the four layers (sources, their controls, mix, blend, opacity, speed, effects), the background, the master effects, the BPM, the World, the scenes, whether Sonify plays. Start here.',
    inputSchema: {
      type: 'object',
      properties: {
        controls: { type: 'boolean', description: 'Include every unit\'s control values (default true; false for a short outline).' }
      }
    },
    readOnly: true
  },
  {
    name: 'snapshot',
    title: 'Look at the output',
    description: 'An image of the output as the audience sees it now. Look after a change to judge it.',
    inputSchema: {
      type: 'object',
      properties: {
        width: { type: 'number', description: 'Image width in pixels, 128-1280 (default 640).' }
      }
    },
    readOnly: true
  },
  {
    name: 'list_shaders',
    title: 'List the sources and effects',
    description:
      'The generators (sources) and effects Palinopsia has, with a line about each : the built-ins and the performer\'s own shaders. Native ones run their own code (no shader source to read).',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['generator', 'effect', 'all'], description: 'Default all.' },
        query: { type: 'string', description: 'Only those whose id, name or description contains this.' }
      }
    },
    readOnly: true
  },
  {
    name: 'describe_shader',
    title: 'Describe a source or effect',
    description: 'A shader\'s description and every control : type, range, default, the labels of a menu. Optionally its ISF source, to start a new shader from it.',
    inputSchema: {
      type: 'object',
      properties: {
        shader: { type: 'string', description: 'Its id or name.' },
        source: { type: 'boolean', description: 'Include the ISF source code (default false).' }
      },
      required: ['shader']
    },
    readOnly: true
  },
  {
    name: 'set_source',
    title: 'Put a source on a layer',
    description:
      'Play a generator on a layer\'s source slot A or B, or on the background (layer "bg"). "none" empties the slot (B, or the background). Optional starting values for its controls.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: { type: ['number', 'string'], description: '1-4, or "bg".' },
        slot: { type: 'string', enum: ['A', 'B'], description: 'Default A (ignored for bg).' },
        shader: { type: 'string', description: 'A generator id or name, or "none".' },
        values
      },
      required: ['layer', 'shader']
    }
  },
  {
    name: 'set_controls',
    title: 'Set controls',
    description: 'Set the controls of one unit (a source, an effect, a master unit, the background).',
    inputSchema: { type: 'object', properties: { unit, values }, required: ['unit', 'values'] }
  },
  {
    name: 'set_layer',
    title: 'Set a layer',
    description:
      'A layer\'s own settings : opacity 0-1, blend (against the layers below), mix 0-1 (A to B), source_blend (how B meets A), mute, solo, speed (its clock, 1 = real time, 0-4), feedback (sample its own last frame) and trail 0-1, harmony -1 to 1 (the colors of B set against those of A : -1 matched to the hue of A, 0 untouched, 1 on its complement). The background takes opacity, speed, depth (its shadow) and group (true : the layers composite alone over it).',
    inputSchema: {
      type: 'object',
      properties: {
        layer: { type: ['number', 'string'], description: '1-4, or "bg".' },
        opacity: { type: 'number' },
        blend: { type: 'string', description: 'normal add subtract multiply screen overlay softlight hardlight darken lighten difference exclusion dodge burn wrap weave lumakey consume lightercolor' },
        mix: { type: 'number' },
        source_blend: { type: 'string' },
        mute: { type: 'boolean' },
        solo: { type: 'boolean' },
        speed: { type: 'number' },
        feedback: { type: 'boolean' },
        trail: { type: 'number' },
        harmony: { type: 'number' },
        depth: { type: 'number' },
        group: { type: 'boolean' }
      },
      required: ['layer']
    }
  },
  {
    name: 'add_effect',
    title: 'Add an effect',
    description: 'Add an effect to a rack (at the end, or at a position), with optional starting values. Returns its unit address.',
    inputSchema: {
      type: 'object',
      properties: {
        rack,
        shader: { type: 'string', description: 'An effect id or name.' },
        position: { type: 'number', description: '1 = first. Default : last.' },
        values
      },
      required: ['rack', 'shader']
    }
  },
  {
    name: 'edit_effect',
    title: 'Change an effect',
    description: 'Turn an effect on or off, set its mix (dry/wet 0-1), move it to another position in its rack, or remove it.',
    inputSchema: {
      type: 'object',
      properties: {
        unit: { type: 'string', description: 'The effect : L1.fx.2, L1.A.fx.1, master.fx.1, bg.fx.1.' },
        enabled: { type: 'boolean' },
        mix: { type: 'number' },
        position: { type: 'number', description: 'Move it here (1 = first).' },
        remove: { type: 'boolean' }
      },
      required: ['unit']
    },
    destructive: true
  },
  {
    name: 'write_shader',
    title: 'Write a shader',
    description:
      'Compile an ISF shader (a JSON header between /* and */ declaring the controls, then GLSL ES 1.00 : gl_FragColor, isf_FragNormCoord, RENDERSIZE, TIME, IMG_NORM_PIXEL(image, coord) where coord is a plain vec2 variable; an image input named inputImage makes it an effect; "uniform float PH_speed;" is TIME integrated at the control "speed", jump-free). Errors come back on their lines; once it compiles, it is saved as one of the performer\'s shaders (the Source Editor\'s Shaders folder, "my shaders" in the menus) and an image of it running alone comes back. Writing again a shader you wrote replaces it (and reloads it where it plays); the name of one of the performer\'s own is refused unless replace is true. Saving the file is not an undo step. Optionally put it to work.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Its name (its id becomes user-<name>).' },
        source: { type: 'string', description: 'The whole ISF file.' },
        use: { type: 'string', description: 'Once saved : a generator onto a source slot (L1.A, bg), an effect onto a rack (L1, L1.A, master, bg).' },
        replace: { type: 'boolean', description: 'true : write over the performer\'s own shader of that name (its old file is kept in the Shaders folder\'s history). Ask them first.' },
        values: { type: 'object', description: 'Control values for the preview image (and for `use`).', additionalProperties: true }
      },
      required: ['name', 'source']
    },
    destructive: true
  },
  {
    name: 'preview_shader',
    title: 'Preview a shader alone',
    description: 'An image of one source or effect running alone, off the output (an effect shows over a stock picture). Nothing on screen changes.',
    inputSchema: {
      type: 'object',
      properties: {
        shader: { type: 'string', description: 'Its id or name.' },
        values: { type: 'object', additionalProperties: true },
        time: { type: 'number', description: 'Seconds into its clock (default 4).' }
      },
      required: ['shader']
    },
    readOnly: true
  },
  {
    name: 'scenes',
    title: 'Scenes',
    description: 'The scene bank : list them, recall one (it morphs over the Transport\'s morph time), save the current state as a new scene, rename or delete one. Scenes count from 1.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'recall', 'save', 'rename', 'delete'] },
        scene: { type: 'number', description: 'Which (recall, rename, delete).' },
        name: { type: 'string', description: 'The name (save, rename).' }
      },
      required: ['action']
    },
    destructive: true
  },
  {
    name: 'list_controls',
    title: 'List the OSC controls',
    description:
      'Every control Palinopsia answers over OSC (addresses with what each does) : Sonify, the World, the field macros, the temperament, Meta knobs, the output transform, the sequencer and more. Use a prefix to narrow it (e.g. /opsia/sonify).',
    inputSchema: {
      type: 'object',
      properties: { prefix: { type: 'string', description: 'Only addresses starting with this.' } }
    },
    readOnly: true
  },
  {
    name: 'osc',
    title: 'Send an OSC control',
    description:
      'Drive any control by its OSC address, exactly as a controller would (list_controls has them). Numbers go as 0-1 floats scaled to the control\'s range (1 is the top, the last of a menu); triggers fire on 1. An address list_controls marks as an index takes a whole number as that index; {"int": n} sends an OSC int anywhere.',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'e.g. /opsia/world, /opsia/sonify/on, /opsia/meta/3' },
        args: { type: 'array', description: 'Its arguments : numbers, strings, booleans, or {"int": n} for an explicit OSC int.', items: {} }
      },
      required: ['address']
    }
  },
  {
    name: 'undo',
    title: 'Undo',
    description: 'Undo your own last change(s) : each change you make is one undo step. It never undoes the performer\'s : once they changed something after you, or for a change that made no step (a saved shader file, the output transform), it says so and undoes nothing.',
    inputSchema: {
      type: 'object',
      properties: { steps: { type: 'number', description: 'How many (default 1, at most 20).' } }
    }
  }
]

/** One call, main → page. */
export interface McpCall {
  id: number
  name: string
  args: Record<string, unknown>
  client: string
}

/** What a tool returns : MCP content blocks. */
export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
export interface McpResult {
  content: McpContent[]
  isError?: boolean
}

export interface McpStatus {
  listening: boolean
  port: number
  error?: string
}

export const MCP_DEFAULT_PORT = 9311
