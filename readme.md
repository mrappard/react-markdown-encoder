# react-markdown-encoder

React component to render markdown with optional hidden Unicode text encoding.

`react-markdown-encoder` is a fork of
[`remarkjs/react-markdown`][react-markdown].
It keeps the same safe markdown-to-React pipeline and adds a `text` prop.
That prop can encode a hidden payload into rendered markdown elements with
Unicode variation selectors.

## Features

* Safe markdown rendering by default, without `dangerouslySetInnerHTML`.
* Compatible with remark and rehype plugins.
* Supports custom React components for rendered markdown elements.
* Optional hidden text encoding through the `text` prop.
* Skips elements that do not have enough visible text to carry the payload.
* ESM-only package for Node.js 16+ and modern bundlers.

## Install

```sh
npm install react-markdown-encoder
```

## Use

Render markdown:

```js
import React from 'react'
import {createRoot} from 'react-dom/client'
import MarkdownEncoder from 'react-markdown-encoder'

const markdown = '# Hi, *Pluto*!'

createRoot(document.body).render(<MarkdownEncoder>{markdown}</MarkdownEncoder>)
```

Render markdown and encode hidden text into eligible elements:

```js
import React from 'react'
import {createRoot} from 'react-dom/client'
import MarkdownEncoder from 'react-markdown-encoder'

const markdown = `
# A long enough heading for encoding

This paragraph has enough visible text to carry a hidden payload.
`

createRoot(document.body).render(
  <MarkdownEncoder text="hidden payload">{markdown}</MarkdownEncoder>
)
```

The visible output remains normal markdown-rendered React content.
Hidden bytes are attached to visible characters as Unicode variation selectors.
Elements that are too short, void elements such as `<hr>`, and elements without
text children are left unchanged.

## API

This package exports:

* `MarkdownEncoder`
* `MarkdownEncoderAsync`
* `MarkdownEncoderHooks`
* `defaultUrlTransform`

The default export is `MarkdownEncoder`.

It also exports TypeScript types generated from the implementation, including:

* `AllowElement`
* `Components`
* `ExtraProps`
* `HooksOptions`
* `Options`
* `UrlTransform`

### `MarkdownEncoder`

Synchronous React component that renders markdown to React elements.

```js
import MarkdownEncoder from 'react-markdown-encoder'

<MarkdownEncoder text="optional hidden text">
  {'This paragraph can carry a payload.'}
</MarkdownEncoder>
```

### `MarkdownEncoderAsync`

Async component for server rendering when async plugins are used.

```js
import {MarkdownEncoderAsync} from 'react-markdown-encoder'
```

### `MarkdownEncoderHooks`

Client-side hooks component for async plugins.

```js
import {MarkdownEncoderHooks} from 'react-markdown-encoder'
```

### Options

`react-markdown-encoder` supports the core options inherited from
`react-markdown`:

* `allowElement`
* `allowedElements`
* `children`
* `components`
* `disallowedElements`
* `rehypePlugins`
* `remarkPlugins`
* `remarkRehypeOptions`
* `skipHtml`
* `unwrapDisallowed`
* `urlTransform`

It adds:

* `text` (`string`, optional) - hidden text to encode into rendered markdown
  elements.

## Encoding Behavior

The encoder builds a hidden payload block containing:

* magic bytes
* version
* payload length
* UTF-8 payload
* CRC32

Each hidden byte is represented as a Unicode variation selector appended to a
visible character.
Because one hidden byte needs one visible carrier character, an element must
have enough direct visible text to hold the complete block.
If it does not, the element is skipped.

Existing variation selectors in a text node are stripped before the current
payload is encoded, which keeps repeated renders from stacking hidden data.

## Plugins And Components

Remark and rehype plugins work as they do in `react-markdown`:

```js
import MarkdownEncoder from 'react-markdown-encoder'
import remarkGfm from 'remark-gfm'

<MarkdownEncoder remarkPlugins={[remarkGfm]}>
  {'Just a link: www.nasa.gov.'}
</MarkdownEncoder>
```

Custom components are also supported:

```js
<MarkdownEncoder
  components={{
    h1(props) {
      return <h2 {...props} />
    }
  }}
>
  {'# Heading'}
</MarkdownEncoder>
```

## Security

This package inherits the safe-by-default rendering model from
`react-markdown`: it does not use `dangerouslySetInnerHTML`, and unsafe URL
protocols are filtered by `defaultUrlTransform`.

Hidden text encoding is not encryption.
Treat encoded text as discoverable by anyone who knows to inspect Unicode
variation selectors.

## Fork Attribution

This project is forked from
[`remarkjs/react-markdown`][react-markdown], which is MIT licensed.
The original project authors and contributors are listed in `package.json`, and
the historical upstream changelog is retained in `changelog.md`.

## License

MIT

[react-markdown]: https://github.com/remarkjs/react-markdown
