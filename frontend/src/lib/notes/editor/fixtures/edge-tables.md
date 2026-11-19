# Tables the grid must read as the renderers do

Chips, whose pipe is no cell break:

| Proof | Media | Note |
| --- | --- | --- |
| [[entity:e_a1|YEMEN Proof 50]] | [[media:m_b2|Board 03]]{width=50% caption="Left | right"} | two [[entity:e_c3|chips]] in [[entity:e_d4|one cell]] |
| [[entity:e_e5|label with a \| pipe]] | ![Shot](/files/c1/a.png){caption="a|b"} | ![Plain](/files/c1/b.png) |

Escaped pipes, code spans and links:

| Kind | Cell | Other |
| :--- | :---: | ---: |
| escaped | a \| b | `x \| y` |
| code splits | `a | b` |
| two slashes | c \\| d | e |
| link | [site](https://example.org/a|b) | [ok](https://example.org/a\|b) |
| emphasis | **bold** and *it* | ~~struck~~ |

Ragged rows, empty cells and a line of prose under the table:

| One | Two | Three |
| --- | --- | --- |
| a |
| a | b |
| a | b | c | d | e |
|  | | |
||x||
A line of prose written right under the table.

Without the pipes at the ends:

Name | Value
-----|------:
alpha | 1
beta | 2 |
| gamma | 3

Padded:

| Model         | Grade       | At least |
| :------------ | :---------- | -------: |
| Streit Cougar | identified  |        8 |
| Al-Wahsh      | almost sure |        2 |

Indented by three spaces, with a tab in a cell:

   | a | b |
   |---|---|
   | 1	2 | 3 |

One column:

| Only |
| --- |
| one |
| |

Emoji, right-to-left text and a long cell:

| Sign | Text | Long |
| --- | --- | --- |
| 🛰️ 👍🏽 🇫🇷 | قوات درع الوطن \| باب المندب | Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. |
| ‏RTL mark | ي | x |

A header and nothing under it:

| Only | A header |
| --- | --- |

Ended by a list:

| a | b |
| --- | --- |
| 1 | 2 |
- a list item

Ended by a heading, a quote, a fence, a comment and a block:

| a | b |
| --- | --- |
| 1 | 2 |
## Heading

| a | b |
| --- | --- |
| 1 | 2 |
> quote

| a | b |
| --- | --- |
| 1 | 2 |
```
code
```

| a | b |
| --- | --- |
| 1 | 2 |
<!-- pagebreak -->

::: center
| a | b |
| --- | --- |
| 1 | 2 |
:::

Not tables:

```
| in | a fence |
| --- | --- |
```

<div>
| in | HTML |
| --- | --- |
</div>

| a | b |
| --- |

    | indented | as code |
    | --- | --- |

A header holding only an escaped pipe:

a \| b
---

The pipe of a chip alone:

[[entity:e_f6|alone]]
---

Settings under the last row, which are no row:

| Model | Grade |
| --- | --- |
| Cougar | confirmed |
{stripes colour="Grade" caption="Losses"}

Braces that are a row: no setting named, or a row under them:

| Only |
| --- |
| a |
{x}

| a | b |
| --- | --- |
| 1 | 2 |
{stripes}
| 3 | 4 |
