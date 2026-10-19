---
title: A small machine
date: 2026-10-13
---

# A small machine

This is a sample note: a place to try prose, diagrams, and mathematics before the real stories arrive.

Each visit starts a tiny Linux machine. The interface you are reading is a native program, and this post is part of its image.

## From a file to a page

```mermaid
flowchart LR
  accTitle: From Markdown to a page
  accDescr: Markdown is compiled into Linux, which runs inside the browser.
  A[Markdown] --> B[Linux image]
  B --> C[Browser]
```

The diagram above is compiled when the site is built: ASCII in the terminal, and SVG in Read as text. Its labels and arrows do not need to be calculated when someone opens the page. Press d in the terminal to compare its image version.

## A little mathematics

Inline expressions fit into a sentence: $a^2 + b^2 = c^2$.

Display equations have space to breathe:

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

And the quadratic formula keeps its fraction, square root, and superscripts:

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

## Small details

- Markdown supplies the structure.
- Linux owns the reader and its navigation.
- The browser displays terminal text and images.

> A small space can still hold a complete thought.

| Part | Where it runs |
| --- | --- |
| Note compiler | During the build |
| ncurses reader | Inside Linux |
| Linux machine | In the browser |

## Until next time

This is the end of the sample note. Return to the Notes index to choose another post.
