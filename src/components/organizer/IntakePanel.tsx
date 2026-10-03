"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import type { DetectedItem, Product } from "@/lib/types";
import { cropDataUrl, fileToResizedDataUrl } from "@/lib/resizeImage";
import { apiFetch } from "./api";

type Review = { image: string; imageId: number; items: DetectedItem[] };
type SavedImage = { id: number; url: string | null; detectedCount: number; createdAt: string };
type Details = { brand: string; name: string; category: string | null; format: string | null; price: string | null; claims: string[]; attributes: Record<string, string | null> };
type Fields = { brand: string; name: string; category: string; format: string; price: string; claims: string };
const blank: Fields = { brand: "", name: "", category: "", format: "", price: "", claims: "" };
const key = (brand: string, name: string) => `${brand.trim().toLowerCase().replace(/\s+/g, " ")}::${name.trim().toLowerCase().replace(/\s+/g, " ")}`;

export function IntakePanel({ id, editable, products, onProduct, onRemove, onIntake }: { id: string; editable: boolean; products: Product[]; onProduct: (product: Product) => void; onRemove: (id: string) => void; onIntake: () => void }) {
  const base = `/api/events/${encodeURIComponent(id)}`;
  const [review, setReview] = useState<Review | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState("");
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [fields, setFields] = useState<Fields>(blank);
  const [images, setImages] = useState<SavedImage[]>([]);

  useEffect(() => {
    let active = true;
    fetch(`${base}/images`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ images: SavedImage[] }> : Promise.reject())
      .then((result) => { if (active) setImages(result.images); })
      .catch(() => { if (active) setError("Saved shelf photos could not be loaded. Refresh to retry."); });
    return () => { active = false; };
  }, [base]);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Choose a JPEG, PNG or other image file."); return; }
    setBusy("Reading and scanning shelf…"); setError(""); setNotice(""); setReview(null);
    try {
      const image = await fileToResizedDataUrl(file);
      const result = await apiFetch<{ items: DetectedItem[]; imageId: number }>(`${base}/detect`, "POST", { image });
      const existing = new Set(products.map(p => key(p.brand, p.name)));
      const available = new Set<number>();
      result.items.forEach((item, index) => { const name = key(item.brand, item.nameGuess); if (!existing.has(name)) { available.add(index); existing.add(name); } });
      setSelected(available);
      setReview({ image, imageId: result.imageId, items: result.items });
      setImages((previous) => [{ id: result.imageId, url: image, detectedCount: result.items.length,
        createdAt: new Date().toISOString() }, ...previous]);
      onIntake();
      setNotice(result.items.length ? `${result.items.length} pack${result.items.length === 1 ? "" : "s"} found. Review before adding to your panel.` : "No packs found. Try another angle or add products manually.");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to read that image."); }
    finally { setBusy(""); }
  }

  async function confirm() {
    if (!review || !selected.size) return;
    setBusy("Extracting product details…"); setCompleted(0); setError(""); setNotice("");
    const seen = new Set(products.map(p => key(p.brand, p.name)));
    const tasks = [...selected].sort((a, b) => a - b).filter(i => { const item = review.items[i]; const identity = key(item.brand, item.nameGuess); if (seen.has(identity)) return false; seen.add(identity); return true; });
    const failures = new Set<number>();
    let fallbackCount = 0;
    let skippedCount = 0;
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const index = tasks[cursor++];
        const item = review.items[index];
        try {
          const crop = await cropDataUrl(review.image, item.box, 520);
          const thumb = await cropDataUrl(review.image, item.box, 240);
          let details: Details | null = null;
          try { details = (await apiFetch<{ details: Details }>(`${base}/extract`, "POST", { crop })).details; }
          catch { fallbackCount++; }
          const attributes = Object.fromEntries(Object.entries(details?.attributes || {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
          const brand = (details?.brand?.trim() || item.brand.trim() || "Unknown brand").slice(0, 80);
          const name = (details?.name?.trim() || item.nameGuess.trim() || "Unnamed product").slice(0, 120);
          const identity = key(brand, name);
          if (identity !== key(item.brand, item.nameGuess) && seen.has(identity)) { skippedCount++; continue; }
          seen.add(identity);
          const result = await apiFetch<{ product: Product }>(`${base}/products`, "POST", { brand, name, category: details?.category?.slice(0, 60) || null, format: details?.format?.slice(0, 40) || item.format?.slice(0, 40) || null, price: details?.price?.slice(0, 30) || null, claims: (details?.claims || []).slice(0, 10).map(claim => claim.slice(0, 60)), attributes, box: item.box, thumb, source_image_id: review.imageId });
          onProduct(result.product);
        } catch { failures.add(index); }
        finally { setCompleted(current => current + 1); }
      }
    }));
    if (failures.size) setError(`${failures.size} product${failures.size === 1 ? "" : "s"} could not be saved. Select and retry those packs.`);
    const remaining = review.items.filter((_, index) => failures.has(index));
    setReview(remaining.length ? { ...review, items: remaining } : null);
    setSelected(new Set(remaining.map((_, index) => index)));
    const saved = tasks.length - failures.size - skippedCount;
    setNotice(`${saved} product${saved === 1 ? "" : "s"} added.${skippedCount ? ` ${skippedCount} duplicate${skippedCount === 1 ? "" : "s"} skipped.` : ""}${fallbackCount ? ` ${fallbackCount} detail extraction${fallbackCount === 1 ? "" : "s"} failed; please review the saved names manually.` : ""}`);
    setBusy("");
  }

  function edit(product: Product) {
    setEditingId(product.id); setManual(false); setRemoveId(null); setError("");
    setFields({ brand: product.brand, name: product.name, category: product.category || "", format: product.format || "", price: product.price || "", claims: product.claims.join(", ") });
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy("Saving product…"); setError("");
    const payload = { brand: fields.brand.trim(), name: fields.name.trim(), category: fields.category.trim() || null, format: fields.format.trim() || null, price: fields.price.trim() || null, claims: fields.claims.split(",").map(s => s.trim()).filter(Boolean) };
    try {
      if (editingId) {
        await apiFetch<{ ok: boolean }>(`${base}/products/${editingId}`, "PATCH", payload);
        const current = products.find(p => p.id === editingId);
        if (current) onProduct({ ...current, ...payload });
      } else {
        const result = await apiFetch<{ product: Product }>(`${base}/products`, "POST", payload);
        onProduct(result.product);
      }
      setFields(blank); setEditingId(null); setManual(false); setNotice("Product saved.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save product."); }
    finally { setBusy(""); }
  }
  async function remove(productId: string) {
    setBusy("Removing product…"); setError("");
    try { await apiFetch<{ ok: boolean }>(`${base}/products/${productId}`, "DELETE"); onRemove(productId); setRemoveId(null); setNotice("Product removed."); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not remove product."); }
    finally { setBusy(""); }
  }
  const duplicates = new Set(products.map(p => key(p.brand, p.name)));
  return <>
    <section className="so-panel so-section-panel"><span className="so-kicker">01 / INTAKE</span><h2>Start with the shelf.</h2><p>Photograph the full lineup. We find the packs, you decide what belongs in the panel. Add another photo for hard-to-see products.</p>
      {editable ? <label className="so-upload"><input type="file" accept="image/*" onChange={upload} disabled={Boolean(busy)} aria-label="Upload a shelf photo" /><span className="so-upload-icon" aria-hidden="true">▧</span><strong>{busy === "Reading and scanning shelf…" ? <><span className="so-spinner" /> Scanning shelf…</> : "Choose a shelf photo"}</strong><span>JPEG or PNG · automatically resized for analysis</span></label> : <div className="so-preview-note">Intake is closed. The lineup was frozen when the prediction was locked.</div>}
      {review && <div><div className="so-image-preview"><Image src={review.image} width={1000} height={750} unoptimized alt="Uploaded shelf with detected products outlined" />{review.items.map((item, i) => <div key={i} className={`so-detect-box ${!selected.has(i) ? "so-detect-box-muted" : ""}`} style={{ left: `${Math.max(0, item.box.x * 100)}%`, top: `${Math.max(0, item.box.y * 100)}%`, width: `${Math.min(item.box.w * 100, 100 - item.box.x * 100)}%`, height: `${Math.min(item.box.h * 100, 100 - item.box.y * 100)}%` }}><span>{String(i + 1).padStart(2, "0")}</span></div>)}</div><div className="so-toolbar"><h2>Review {review.items.length} detected packs</h2><span>{selected.size} SELECTED</span></div><div className="so-review-list">{review.items.map((item, i) => <label className={`so-review-item ${!selected.has(i) ? "so-review-item-disabled" : ""}`} key={i}><input type="checkbox" checked={selected.has(i)} disabled={Boolean(busy)} onChange={() => setSelected(previous => { const next = new Set(previous); if (next.has(i)) next.delete(i); else next.add(i); return next; })} /><div><strong>{item.brand || "Unknown brand"}</strong><span>{item.nameGuess || "Unnamed product"} · {item.format || "pack"}</span></div><span className={`so-pill so-pill-${duplicates.has(key(item.brand, item.nameGuess)) ? "amber" : "violet"}`}>{duplicates.has(key(item.brand, item.nameGuess)) ? "ALREADY ADDED" : `PACK ${i + 1}`}</span></label>)}</div><div className="so-inline-actions"><button type="button" className="so-button so-button-violet" disabled={Boolean(busy) || !selected.size} onClick={confirm}>{busy === "Extracting product details…" ? <><span className="so-spinner" /> Adding {completed}/{selected.size}</> : `Add ${selected.size} selected to panel ↗`}</button><button type="button" className="so-button so-button-outline" disabled={Boolean(busy)} onClick={() => setReview(null)}>Dismiss review</button></div>{busy === "Extracting product details…" && <div className="so-progress" role="progressbar" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={selected.size}><i style={{ width: `${selected.size ? completed / selected.size * 100 : 0}%` }} /></div>}</div>}
      {images.length > 0 && <details className="mt-6 border-t border-line pt-4"><summary className="cursor-pointer text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-ai">Saved shelf photos · {images.length}</summary><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{images.map((saved) => <figure key={saved.id} className="overflow-hidden rounded-lg border border-line bg-white">{saved.url ? <Image src={saved.url} alt={`Shelf photo with ${saved.detectedCount} detected products`} width={400} height={300} unoptimized className="aspect-[4/3] w-full object-cover" /> : <div className="flex aspect-[4/3] items-center justify-center bg-muted text-sm text-quiet">Photo unavailable</div>}<figcaption className="p-3 text-xs text-quiet">{saved.detectedCount} detected · {new Date(saved.createdAt).toLocaleDateString("en-GB")}</figcaption></figure>)}</div></details>}
      {error && <div className="so-alert" role="alert" style={{ marginTop: 14 }}>{error}</div>}{notice && <div className="so-alert so-alert-success" role="status" style={{ marginTop: 14 }}>{notice}</div>}
    </section>
    <section className="so-panel so-section-panel"><div className="so-toolbar"><h2>Panel lineup</h2><span>{products.length} PRODUCTS</span></div><p>Clean up names and details before drafting a prediction. Each product gets its own vote card.</p>
      {products.length ? <div className="so-product-list">{products.map(product => <div className="so-product-item" key={product.id}>{product.thumb ? <Image className="so-product-thumb" src={product.thumb} width={46} height={52} unoptimized alt={`Photo of ${product.brand} ${product.name}`} /> : <span className="so-product-thumb so-product-placeholder" aria-hidden="true">▤</span>}<div className="so-product-info"><strong>{product.brand} — {product.name}</strong><small>{[product.category, product.format, product.price].filter(Boolean).join(" · ") || "Details not added yet"}</small></div>{editable && <div className="so-product-actions"><button type="button" disabled={Boolean(busy)} onClick={() => edit(product)}>Edit</button><button type="button" disabled={Boolean(busy)} onClick={() => { setRemoveId(product.id); setEditingId(null); }}>Remove</button></div>}</div>)}</div> : <div className="so-empty"><span className="so-empty-icon" aria-hidden="true">▥</span><h3>No products yet.</h3><p>Upload a shelf photo to find packs automatically, or add the lineup one product at a time.</p></div>}
      {removeId && editable && <div className="so-lock-panel"><h3>Remove this product?</h3><p>This cannot be undone.</p><div className="so-inline-actions"><button type="button" className="so-button so-button-amber" disabled={Boolean(busy)} onClick={() => remove(removeId)}>Yes, remove</button><button type="button" className="so-button so-button-outline" onClick={() => setRemoveId(null)}>Keep product</button></div></div>}
      {editable && !manual && !editingId && <button type="button" className="so-button so-button-outline" style={{ marginTop: 18 }} onClick={() => { setFields(blank); setManual(true); setError(""); }}>+ Add a product manually</button>}
      {editable && (manual || editingId) && <form className="so-edit-form" onSubmit={save}><div className="so-field-wide"><strong>{editingId ? "Edit product" : "Add a product"}</strong></div><label className="so-field">Brand<input className="so-input" required maxLength={80} value={fields.brand} onChange={e => setFields({ ...fields, brand: e.target.value })} /></label><label className="so-field">Product / variant<input className="so-input" required maxLength={120} value={fields.name} onChange={e => setFields({ ...fields, name: e.target.value })} /></label><label className="so-field">Category<input className="so-input" maxLength={60} value={fields.category} onChange={e => setFields({ ...fields, category: e.target.value })} /></label><label className="so-field">Format<input className="so-input" maxLength={40} value={fields.format} onChange={e => setFields({ ...fields, format: e.target.value })} /></label><label className="so-field">Price / size<input className="so-input" maxLength={30} value={fields.price} onChange={e => setFields({ ...fields, price: e.target.value })} /></label><label className="so-field">Claims <small>Separate with commas; up to 10</small><input className="so-input" value={fields.claims} onChange={e => setFields({ ...fields, claims: e.target.value })} /></label><div className="so-inline-actions"><button className="so-button so-button-violet" disabled={Boolean(busy)} type="submit">{busy === "Saving product…" ? "Saving…" : "Save product"}</button><button type="button" className="so-button so-button-outline" onClick={() => { setManual(false); setEditingId(null); setFields(blank); }}>Cancel</button></div></form>}
    </section>
  </>;
}
