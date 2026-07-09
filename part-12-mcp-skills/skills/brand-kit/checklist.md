# Brand-kit exit checklist

- [ ] Every color in the CSS is one of the `:root` custom properties.
- [ ] The palette matches the resolution you reported (brief vs assets).
- [ ] Every asset the pages reference lives under the site's own
      folders — `grep -rn "brief/" *.html` returns nothing.
- [ ] The logo renders in every place the brief asked for, with the
      client's name as alt text.
- [ ] Copy taken from the client's files is verbatim (names, prices,
      addresses, hours).
- [ ] Your final message names any brief-vs-asset contradiction and
      the side you styled with.
