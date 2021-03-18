# Custom Modules <small></small>

> Custom Modules are completely open-ended components that allow you to create new experiences within the Directus
> platform. [Learn more about Modules](/concepts/modules/).

## 1. Setup the Boilerplate

Every module is a standalone "package" that contains at least a metadata file and a Vue component. We recommend using
the following file structure:

```
src/
	index.js
	module.vue
```

### src/index.js

```js
import ModuleComponent from './module.vue';

export default {
	id: 'custom',
	name: 'Custom',
	icon: 'box',
	routes: [
		{
			path: '/',
			component: ModuleComponent,
		},
	],
};
```

- `id` — The unique key for this module. It is good practice to scope proprietary interfaces with an author prefix.
- `name` — The human-readable name for this module.
- `icon` — An icon name from the material icon set, or the extended list of Directus custom icons.
- `routes` — Details the routes in your module per the Vue router.

::: tip TypeScript

See
[the TypeScript definition](https://github.com/directus/directus/blob/20355fee5eba514dd75565f60269311187010c66/app/src/modules/types.ts#L6-L17)
for more info on what can go into this object.

:::

### src/module.vue

```vue
<template>
	<private-view title="My Custom Module">Content goes here...</private-view>
</template>

<script>
export default {};
</script>
```

#### Available Props

If you setup a route with a parameter, you can pass it in as a prop.

## 2. Install Dependencies and Configure the Buildchain

Set up a package.json file by running:

```bash
npm init -y
```

To be read by the Admin App, your custom module's Vue component must first be bundled into a single `index.js` file. We
recommend bundling your code using Rollup. To install this and the other development dependencies, run this command:

```bash
npm i -D rollup rollup-plugin-commonjs rollup-plugin-node-resolve rollup-plugin-terser rollup-plugin-vue@5.0.0 @vue/compiler-sfc rollup-plugin-vue@next
```

You can then use the following Rollup configuration within `rollup.config.js`:

```js
import { terser } from 'rollup-plugin-terser';
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import vue from 'rollup-plugin-vue';

export default {
	input: 'src/index.js',
	output: {
		format: 'es',
		file: 'dist/index.js',
	},
	plugins: [terser(), resolve(), commonjs(), vue()],
};
```

## 3. Develop Your Custom Module

The module itself is simply a Vue component, which provides an blank canvas for creating anything you need.

## 4. Build and Deploy

To build the module for use within Directus, run:

```bash
npx rollup -c
```

Finally, move the output from your module's `dist` folder into your project's `/extensions/modules` folder. Keep in mind
that the extensions directory is configurable within your env file, and may be located elsewhere.
