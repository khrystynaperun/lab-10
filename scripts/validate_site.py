from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SiteParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.duplicate_ids = set()
        self.fragments = []
        self.gallery_items = 0
        self.gallery_items_without_captions = 0

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)

        element_id = attributes.get("id")
        if element_id:
            if element_id in self.ids:
                self.duplicate_ids.add(element_id)
            self.ids.add(element_id)

        href = attributes.get("href", "")
        if href.startswith("#"):
            self.fragments.append(href[1:])

        if attributes.get("data-fancybox") == "coffee-gallery":
            self.gallery_items += 1
            if not attributes.get("data-caption"):
                self.gallery_items_without_captions += 1


html_path = ROOT / "index.html"
parser = SiteParser()
parser.feed(html_path.read_text(encoding="utf-8"))
parser.close()

errors = []
if parser.duplicate_ids:
    errors.append(f"Duplicate IDs: {', '.join(sorted(parser.duplicate_ids))}")

broken_fragments = sorted(set(parser.fragments) - parser.ids)
if broken_fragments:
    errors.append(f"Broken in-page links: {', '.join(broken_fragments)}")

if parser.gallery_items != 3:
    errors.append(f"Expected 3 gallery images, found {parser.gallery_items}")

if parser.gallery_items_without_captions:
    errors.append("Every gallery image must have a data-caption")

if "typed-text" not in parser.ids:
    errors.append("Hero is missing the #typed-text element")

if not (ROOT / "assets" / "Logo.png").is_file():
    errors.append("The site logo is missing")

if errors:
    raise SystemExit("\n".join(errors))

print("Static site validation passed.")
