# statement

this is the project's political accounting — why yomiko exists, how it participates in the AI ecosystem, what stance the README rests on. separate from the README so that one can stay practical.

## why this exists

the use of AI in consumer products has social and political consequences, particularly when its inclusion is driven by metrics that are orthogonal to the public good. one such consequence is the enclosure of artistic tradition and practice.

i think of art as a *social practice*: the common heritage of human culture and history. not a mode of cultural consumption; not a selection of consumable goods ranked along some spectrum of cultural importance; it's something that circulates between makers, audiences, traditions. and it's the move of capital to wedge itself into those circulations and gate them, enclosing both the production of art and its passage to the audiences who would receive it.

yomiko exists in opposition to the arrangement under which private interests dictate which cultural products are *worthy* of consumption based on expected return, and thereby dictate what audiences can exist at all. yomiko isn't trying to further expropriate the creative and cognitive labor of the artists who brought these works into existence, nor that of the translators and localizers whose work is the reason any of this medium has crossed language at all. the opposition is to the gating apparatus, not to the labor inside it.

yomiko knowingly inhabits a contradiction: using a tool built on one form of enclosure to resist another.

## the data path

yomiko's translation feature sends a captured image — either a per-line crop on hover or the full frame on `⌘⇧T` — to qwen2.5-VL, a vision-language model hosted on OpenRouter and reached through a Cloudflare Worker proxy in this repo. the Worker forwards without logging. OpenRouter's stated policy is no-training on API traffic. underlying providers vary. i can't guarantee any of that on your behalf; bytes pass through services with their own retention practices.

if the concern is "is my screenshot going into someone's training set tomorrow," the answer is probably not. i can't promise on behalf of every service in the chain.

## what the model already is

training data going forward is the easy concern. the harder one is what the model itself already *is*. pasquinelli puts it directly in *eye of the master*: the corpus is the labour. qwen and language models like it were trained on a corpus that includes art and writing scraped without contributor consent. the model isn't a separate thing that *uses* that work as raw material; the model **is** that work, statistically compressed and re-served as an API. when you ⌘⇧T a vertical mantra panel and get back "On Marishi-ten Sowaka—", that production is borrowed labor. buddhist translation traditions, sanskrit-japanese lexicographers, the specific human who wrote the reference qwen scraped that romanization out of, fast-forwarded into one API call and billed at a fraction of a cent.

"we don't contribute back to training" is a partial answer. it addresses marginal labor going forward; it doesn't address the base model. the base model is the expropriation. using it perpetuates and capitalizes the loop, no matter how clean the API hygiene downstream.

the same critique applies to neural machine translation, often more directly. deepl traces back to linguee's bilingual web scrape, much of which is professional translator output that no one asked about. google translate: same shape, different corpora. there is no "ethical neural MT" you can swap in to dissolve the critique. the question is the underlying mode of accumulation, not which model has the cleanest hands.

## commons and enclosure

not all collective intelligence in this stack arrives the same way. the general intellect — as defined by italian autonomists by way of the *grundrisse* — takes different organizational forms. some collective intelligence is **deliberately commoned**: contributors meant the work to stay shared and made it under arrangements that protect that. some is **enclosed**: scraped from contexts where the contributors retained their rights and got nothing in exchange for the privatization.

in yomiko's stack:

- **[JMdict](https://www.edrdg.org/jmdict/edict_doc.html)**, the Japanese-English dictionary: commons. breen and the EDRDG have curated it since 1991. volunteer-contributed, freely licensed, intentionally a gift. the cleanest provenance in the whole stack.
- **kuromoji**, the morphological tokenizer: open-source, IPADIC-derived, contributed by atilika and the broader NLP research community. commons.
- **qwen2.5-VL**, the translation model: enclosure. trained on a corpus that includes content scraped without contributor consent. open weights are real and matter, but they don't undo where the weights came from.
- **deepl / google translate / etc.**: enclosure. same shape, narrower domain. the translator-displacement loop here is unusually direct: the corpus *is* the work of translators whose labor the model now substitutes for.
- **apple vision OCR**: ambiguous. trained on text-image corpora that almost certainly include scraped material, but the output is glyph identification rather than creative content. recognizing 「あ」 isn't expropriating creative labor in the same way that synthesizing translations or images is. implicated, but less directly.
- **textractor** (planned): bypasses the ML loop entirely. reads the game's script via memory hooks. no commons, no enclosure; just the actual text the game already has on disk.

the relevant distinction is commons-derived tools vs enclosure-derived tools, not "ethical AI vs unethical AI." non-ML options sit at one end.

## what's available

the default install uses the enclosure side: configure the proxy credentials, hover for translation, get qwen's output. that's the path that "just works" and most users will pick it.

alternatives exist:

- **dictionary-only mode.** don't configure `YOMIKO_PROXY_URL` / `YOMIKO_PROXY_TOKEN`. yomiko still runs; hover popups work via kuromoji + JMdict. the commons side of the stack, with apple vision in the gray middle. you lose translation, you keep the reader.
- **textractor mode.** when this lands, yomiko will read the game's script directly from the running process. no image leaves your machine; no model trained on scraped corpora is in the loop. not really workable on mac, though.

these alternatives exist because some users will weigh the contradictions differently and want a stack they can run without the VLM path. they are not, in the analysis above, escape valves from the critique of the base model. dict-only mode means this install didn't make a call; the corpus those calls reach for is still there.

## contradictions

yomiko exists because tools like qwen2.5-VL exist. the project's whole reason for being is that VLMs solved problems (rare-kanji recognition, vertical text, stylized fonts) that constrained-vocab OCR hadn't. building this at all is a vote of confidence in the ecosystem's outputs being useful enough to use. routing carefully and offering opt-outs doesn't put the project outside the critique.

what yomiko is built against is one form of enclosure: corporate gatekeeping of which works cross language, and therefore which audiences exist. what yomiko is built on is another form: the corpus of an enclosure-derived model. i won't pretend either is neutral, and i won't pretend the second cancels the first.

if you read this and decide yomiko isn't for you, i respect it. if you read this and use the VLM path with eyes open, i respect that, too. dict-only and textractor aren't escape valves from the contradictions; they're different arrangements of them, and the only dishonest position is pretending the contradictions don't exist.
