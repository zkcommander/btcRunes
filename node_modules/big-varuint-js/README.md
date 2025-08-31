## Big Varuint Implementation for Javascript
Encode and decode varuint variables flawlessly. It supported uint checker for `u8`, `u16`, `u32`, `u64`, `u128`, the uint  is just a wrapper of `bigint` value.
*if you want to use this library on production please dwyor, really open to any contribution.

## Install
```
npm install big-varuint-js
```

## Example u128
### Encode
```
// 340282366920938463463374607431768211455n
const value = U128_MAX_NUMBER;
const encoded = new U128(value).toVaruint()
// output: Buffer(19) [ 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 3 ]
```
### Decode
```
// U128_MAX_NUMBER
const buff = Buffer.from([
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 3,
]);
const decoded = U128.fromVaruint(buff).toValue();
// output: 340282366920938463463374607431768211455n
```
