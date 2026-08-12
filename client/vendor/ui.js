// Why this file exists: the client has NO build step (DECISIONS D001) — these
// are the vendored libraries, wired together once. Every view imports from
// here, never from the vendor files directly.
//
// REQUIREMENT: index.html must declare an import map BEFORE any module script,
// because preact-hooks.mjs imports the bare specifier "preact":
//   <script type="importmap">{"imports":{"preact":"./vendor/preact.mjs"}}</script>
import { h, render, Component, Fragment } from './preact.mjs';
import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from './preact-hooks.mjs';
import htm from './htm.mjs';

export const html = htm.bind(h);
export {
  h,
  render,
  Component,
  Fragment,
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
};
