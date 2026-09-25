# 🔍 Leather Defect Detection Capabilities & Technical Specification
## Raspberry Pi HQ Camera (SC0261) Inspection System

> **Document Version:** 1.0  
> **Target Equipment:** Raspberry Pi HQ Camera (Sony IMX477, 12.3 MP) + Arducam 2.8–12 mm Varifocal Lens  
> **Application:** Automated Leather Quality Grading & Defect Inspection Station (Dada Enterprises)

---

## 1. Executive Summary & Optical Parameters

The overhead AI vision system utilizes a **12.3 MP Sony IMX477 sensor** paired with an **Arducam 2.8–12 mm C-mount varifocal lens** set to $f = 5.0\text{ mm}$ at a working height of $1,210\text{ mm}$ above the inspection bed.

```
                   ┌─────────────────────────────┐
                   │ RPi HQ Camera (Sony IMX477) │
                   └──────────────┬──────────────┘
                                  │  Focal Distance = 1,210 mm
                                  ▼
┌───────────────────────────────────────────────────────────────────┐
│              Field of View: 1,520 mm x 1,140 mm                   │
│         Spatial Resolution: ~0.374 mm / pixel (12.3 MP)          │
│        Minimum Feature Size: 0.7 - 1.0 mm (2-3 px signal)         │
│          3 mm Defect Target: ~8.02 pixels across                  │
└───────────────────────────────────────────────────────────────────┘
```

### Optical Metrics Breakdown
| Parameter | Value | Impact on Defect Detection |
| :--- | :--- | :--- |
| **Sensor Resolution** | $4056 \times 3040\text{ px}$ (12.3 MP) | High spatial resolution across entire hide surface. |
| **Field of View (FOV)** | $1520 \times 1140\text{ mm}$ | Fully frames hides up to $1350 \times 1000\text{ mm}$ with border margin. |
| **Spatial Resolution** | $\mathbf{0.374\text{ mm / px}}$ | $1\text{ mm}$ feature = $2.67\text{ pixels}$; $3\text{ mm}$ feature = $8.02\text{ pixels}$. |
| **Minimum Feature Size** | $\mathbf{0.70 - 1.0\text{ mm}}$ | Small punctures, flay cuts, and scars are clearly resolved. |

---

## 2. Complete Defect Detection Catalog

Defects are classified into three core operational categories based on defect origin and visual appearance:

### Category A: Structural & Mechanical Defects (Critical / High Rejection Impact)
1. **Holes & Punctures**
   - *Description:* Through-and-through openings, machine punctures, or missing leather material.
   - *Minimum Size:* $\ge 1.0\text{ mm}$ diameter ($\sim 2.7\text{ px}$).
   - *Visual Feature:* High light contrast; 100% luminance in backlit mode.
2. **Flay Cuts & Slice Marks**
   - *Description:* Linear cuts caused by skinning knives, flaying machines, or sharp tools.
   - *Minimum Size:* Length $\ge 3.0\text{ mm}$, opening width $\ge 0.5\text{ mm}$.
   - *Visual Feature:* Linear shadow/contrast edge line under top illumination.
3. **Perimeter Tears & Edge Rips**
   - *Description:* Jagged rips or structural perimeter damage along the hide boundary.
   - *Minimum Size:* Edge notch depth $\ge 2.0\text{ mm}$.
   - *Visual Feature:* Disruption in hide boundary contour segmentation.
4. **Fleshing Gouges & Thinning**
   - *Description:* Deep gouges on the flesh side where leather thickness is severely reduced.
   - *Minimum Size:* Area $\ge 10\text{ mm}^2$.
   - *Visual Feature:* High translucency profile under transmissive backlighting.

---

### Category B: Natural & Biological Surface Defects
5. **Brand Marks**
   - *Description:* Hot iron, freeze, or chemical brand identification marks on the grain side.
   - *Minimum Size:* Area $\ge 25\text{ mm}^2$.
   - *Visual Feature:* Large discolored region with altered surface texture.
6. **Scars & Scratches**
   - *Description:* Healed barbed wire cuts, horn gores, thorn scratches, or animal fight scars.
   - *Minimum Size:* Width $\ge 0.8\text{ mm}$, length $\ge 5.0\text{ mm}$.
   - *Visual Feature:* Linear or curved discoloration; sharp edge contrast line.
7. **Parasite & Insect Damage**
   - *Description:* Tick bites, warble fly holes, mange, or open sore scars.
   - *Minimum Size:* Spot cluster area $\ge 1.0\text{ mm}$.
   - *Visual Feature:* Small dark clusters or raised circular spots.
8. **Vein Marks (Open Veininess)**
   - *Description:* Prominent branching blood vessel patterns on the grain surface.
   - *Minimum Size:* Width $\ge 0.5\text{ mm}$, length $\ge 10.0\text{ mm}$.
   - *Visual Feature:* Branching tree-like dark lines visible under $5000\text{K}$ neutral light.

---

### Category C: Tannery Processing & Handling Defects
9. **Wrinkles & Heavy Neck Folds**
   - *Description:* Deep structural creases, grain wrinkles, or heavy transport fold lines.
   - *Minimum Size:* Width $\ge 2.0\text{ mm}$, length $\ge 20.0\text{ mm}$.
   - *Visual Feature:* Parallel dark shadow bands across hide surface.
10. **Color Patchiness, Salt & Grease Stains**
    - *Description:* Uneven Wet Blue chemical absorption, salt spots, or fat/grease stains.
    - *Minimum Size:* Area $\ge 15\text{ mm}^2$.
    - *Visual Feature:* Localized luminance or color variance under D50/D65 illuminant.
11. **Putrefaction / Decay Spots**
    - *Description:* Bacterial decay patches occurring prior to tanning.
    - *Minimum Size:* Area $\ge 5.0\text{ mm}^2$.
    - *Visual Feature:* Dark, irregular discolored patches.

---

## 3. Dual-Mode Illumination Mapping

To optimize AI segmentation accuracy, defects are mapped to specific lighting modes:

```
                          ┌───────────────────────────┐
                          │   LEATHER INSPECTION BED  │
                          └─────────────┬─────────────┘
                                        │
           ┌────────────────────────────┴────────────────────────────┐
           ▼                                                         ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│  OVERHEAD REFLECTIVE MODE (Top LED)  │  │  BACKLIT TRANSMISSIVE MODE (Bottom)  │
│  - 5000K Daylight, CRI > 97          │  │  - Constant-Current DC LED Panel     │
│  - Detects: Cuts, Scars, Brands,     │  │  - Detects: Holes, Punctures,        │
│    Stains, Veins, Parasite Marks     │  │    Edge Tears, Fleshing Gouges       │
└──────────────────────────────────────┘  └──────────────────────────────────────┘
```

| Illumination Mode | Target Defect Types | AI Segmentation Reliability |
| :--- | :--- | :--- |
| **Backlit Transmissive Mode**<br>*(Light panel under glass/slatted bed)* | • Holes & Punctures<br>• Edge Tears & Rips<br>• Fleshing Gouges & Thinning | **98% – 100% Accuracy**<br>(Direct light transmission creates absolute contrast). |
| **Overhead Reflective Mode**<br>*(5000K Daylight LEDs, CRI > 97)* | • Flay Cuts & Slices<br>• Scars, Scratches & Brands<br>• Stains & Color Variations<br>• Parasite Bites & Veininess | **90% – 95% Accuracy**<br>(Relies on surface shadow and color boundary detection). |

---

## 4. Quality Grading Rules & AI Pipeline Mapping

The detected defects are automatically aggregated by the AI model (`inference-client`) to compute a quality grade for each hide:

```mermaid
flowchart TD
    A[Camera Frame Capture] --> B[YOLO Hide Detector & ByteTrack]
    B --> C[YOLO Defect Segmentation Model]
    C --> D{Defect Evaluation}
    D -- 0 Cuts/Holes & Minor Scars < 5cm2 --► E[GRADE A - Premium]
    D -- 1-2 Minor Cuts OR Holes < 3mm --► F[GRADE B - Standard]
    D -- 3+ Cuts/Holes OR Hole > 10mm --► G[REJECT / SCRAP]
```

### Grade Classification Criteria
* **GRADE A (Premium):**
  - 0 Holes or Cuts.
  - Total defect area $< 0.5\%$ of hide area.
  - Suitable for high-end upholstery / leather goods.
* **GRADE B (Standard):**
  - Maximum 1–2 minor cuts or holes ($< 5\text{ mm}$ each).
  - Minor scar or vein marks present.
  - Suitable for footwear / panel cutting.
* **REJECT / SCRAP:**
  - $\ge 3$ cuts or holes, or any structural hole $> 10\text{ mm}$.
  - Large brand mark occupying prime cutting area.
  - Flagged for scrap or trim recovery.

---

## 5. Technical Limitations & Out-of-Scope Features

To maintain clear operational bounds, the following are classified as **out of scope**:

1. **Sub-Millimeter Micro-Pores ($< 0.3\text{ mm}$):** Tiny microscopic hair follicles or sub-millimeter pin-pricks require macro-telephoto optics or a 24MP+ line-scan system.
2. **Tactile & Mechanical Properties:** Leather suppleness, temper, tensile strength, or softness cannot be measured optically.
3. **Internal Sub-Surface Defects:** Sub-surface collagen fiber structure flaws invisible on both surface and backlighting.

---

*Document generated for Dada Enterprises Leather Quality System.*
