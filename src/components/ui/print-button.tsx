"use client";
import { Button } from "./button";
export function PrintButton() {
  return <Button variant="secondary" onClick={() => window.print()}>Print or save as PDF</Button>;
}
