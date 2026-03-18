"""
Locale strings for browser automation — AutoResolve RDP
Provides localized UI button labels, return reasons, and upload text
for all supported region languages. Used by return_systems.py and step1_handler.py.

Supported regions / languages:
  us/gb/au/ca/in  → English (en)
  de              → German  (de)
  fr              → French  (fr)
  it              → Italian (it)
  es/mx           → Spanish (es)
  nl              → Dutch   (nl)
  jp              → Japanese (ja)
  br              → Portuguese (pt)
"""
from typing import Dict, List

# ─── Region → ISO 639-1 language code ────────────────────────────────────────

REGION_TO_LANG: Dict[str, str] = {
    "us": "en", "gb": "en", "au": "en", "ca": "en", "in": "en",
    "de": "de",
    "fr": "fr",
    "it": "it",
    "es": "es", "mx": "es",
    "nl": "nl",
    "jp": "ja",
    "br": "pt",
}

# ─── UI string dictionary ─────────────────────────────────────────────────────
# Each value is a list of text variants in priority order.
# The first entry is the most natural/common phrasing for that language.
# English variants are always appended as ultimate fallbacks.

UI_STRINGS: Dict[str, Dict[str, List[str]]] = {

    # ── English (base) ────────────────────────────────────────────
    "en": {
        "btn_next":             ["Next", "Continue", "Proceed", "Step 2"],
        "btn_submit":           ["Submit", "Submit Return", "Send", "Done"],
        "btn_confirm":          ["Confirm", "OK", "Accept", "Done"],
        "btn_start_return":     ["Start Return", "Return Item", "Return", "Start a Return", "Initiate Return"],
        "btn_find":             ["Find", "Find Order", "Search", "Look Up"],
        "btn_continue":         ["Continue", "Next", "Proceed"],
        "btn_mail_in":          ["Mail", "Mail Return", "Ship it", "Send Back", "Drop Off"],
        "btn_return":           ["Return", "Start a Return", "Return Item", "Make a Return"],
        "btn_ship_to":          ["Ship to", "Deliver to", "Shipping to"],
        "btn_country":          ["Country", "Region", "Location", "Change country", "Change region"],
        "reason_damaged":       ["Item arrived damaged", "Arrived damaged", "Damaged", "Defective item",
                                  "Item is damaged", "Damaged item", "Product damaged"],
        "reason_wrong_item":    ["Wrong item received", "Wrong item", "Incorrect item",
                                  "Received wrong item", "Sent wrong item"],
        "reason_missing_parts": ["Missing parts or accessories", "Missing parts", "Incomplete",
                                  "Parts missing", "Accessories missing"],
        "reason_not_working":   ["Item not working as described", "Not as described",
                                  "Doesn't work", "Not working", "Defective"],
        "reason_changed_mind":  ["Changed my mind", "No longer needed", "Don't want it",
                                  "Not needed", "Unwanted"],
        "reason_never_arrived": ["Package never arrived", "Did not arrive", "Not received",
                                  "Item not received", "Didn't arrive", "Never arrived"],
        "upload_photo":         ["upload", "add photo", "attach", "add image", "add file"],
    },

    # ── German ────────────────────────────────────────────────────
    "de": {
        "btn_next":             ["Weiter", "Fortfahren", "Nächste", "Next"],
        "btn_submit":           ["Absenden", "Einreichen", "Senden", "Bestätigen", "Submit"],
        "btn_confirm":          ["Bestätigen", "OK", "Akzeptieren", "Confirm"],
        "btn_start_return":     ["Rücksendung starten", "Artikel zurücksenden", "Rückgabe starten",
                                  "Retoure starten", "Rücksendung beginnen", "Return"],
        "btn_find":             ["Suchen", "Bestellung finden", "Suche", "Find"],
        "btn_continue":         ["Weiter", "Fortfahren", "Nächste", "Continue"],
        "btn_mail_in":          ["Per Post einsenden", "Per Post zurücksenden", "Einsenden", "Mail"],
        "btn_return":           ["Zurücksenden", "Rücksendung", "Retoure", "Return"],
        "btn_ship_to":          ["Liefern nach", "Versand nach", "Lieferadresse", "Ship to"],
        "btn_country":          ["Land", "Region", "Standort", "Land ändern", "Region ändern", "Country"],
        "reason_damaged":       ["Artikel beschädigt angekommen", "Beschädigt", "Defekter Artikel",
                                  "Artikel ist beschädigt", "Beschädigte Ware", "Item arrived damaged"],
        "reason_wrong_item":    ["Falscher Artikel erhalten", "Falscher Artikel", "Falsche Ware",
                                  "Artikel falsch", "Wrong item received"],
        "reason_missing_parts": ["Teile fehlen", "Fehlende Teile", "Unvollständig",
                                  "Zubehör fehlt", "Missing parts"],
        "reason_not_working":   ["Artikel funktioniert nicht", "Nicht wie beschrieben",
                                  "Defekt", "Funktioniert nicht", "Not working"],
        "reason_changed_mind":  ["Meinung geändert", "Nicht mehr benötigt", "Nicht gewünscht",
                                  "Changed my mind"],
        "reason_never_arrived": ["Paket nicht angekommen", "Nicht erhalten", "Nicht geliefert",
                                  "Nie angekommen", "Package never arrived"],
        "upload_photo":         ["hochladen", "Foto hinzufügen", "Datei hinzufügen",
                                  "Anhang hinzufügen", "upload", "Bild hochladen"],
    },

    # ── French ────────────────────────────────────────────────────
    "fr": {
        "btn_next":             ["Suivant", "Continuer", "Étape suivante", "Next"],
        "btn_submit":           ["Soumettre", "Envoyer", "Confirmer", "Valider", "Submit"],
        "btn_confirm":          ["Confirmer", "OK", "Valider", "Confirm"],
        "btn_start_return":     ["Commencer le retour", "Retourner l'article", "Démarrer un retour",
                                  "Initier un retour", "Return"],
        "btn_find":             ["Rechercher", "Trouver la commande", "Chercher", "Find"],
        "btn_continue":         ["Continuer", "Suivant", "Passer à l'étape suivante", "Continue"],
        "btn_mail_in":          ["Envoi postal", "Par courrier", "Retour par courrier", "Mail"],
        "btn_return":           ["Retour", "Retourner", "Faire un retour", "Return"],
        "btn_ship_to":          ["Livrer à", "Expédier à", "Livraison vers", "Ship to"],
        "btn_country":          ["Pays", "Région", "Emplacement", "Changer de pays", "Country"],
        "reason_damaged":       ["Article arrivé endommagé", "Endommagé", "Article défectueux",
                                  "Produit abîmé", "Item arrived damaged"],
        "reason_wrong_item":    ["Mauvais article reçu", "Article incorrect", "Mauvais produit",
                                  "Wrong item received"],
        "reason_missing_parts": ["Pièces manquantes", "Accessoires manquants", "Incomplet",
                                  "Missing parts"],
        "reason_not_working":   ["Article ne fonctionne pas", "Non conforme à la description",
                                  "Défectueux", "Not working"],
        "reason_changed_mind":  ["J'ai changé d'avis", "Plus nécessaire", "Ne le souhaite plus",
                                  "Changed my mind"],
        "reason_never_arrived": ["Colis jamais arrivé", "Non reçu", "Pas livré",
                                  "Package never arrived"],
        "upload_photo":         ["télécharger", "ajouter une photo", "joindre", "ajouter un fichier",
                                  "upload"],
    },

    # ── Italian ───────────────────────────────────────────────────
    "it": {
        "btn_next":             ["Avanti", "Continua", "Prossimo", "Next"],
        "btn_submit":           ["Invia", "Conferma", "Invia richiesta", "Submit"],
        "btn_confirm":          ["Conferma", "OK", "Accetta", "Confirm"],
        "btn_start_return":     ["Avvia reso", "Restituisci articolo", "Inizia reso",
                                  "Crea reso", "Return"],
        "btn_find":             ["Cerca", "Trova ordine", "Ricerca", "Find"],
        "btn_continue":         ["Continua", "Avanti", "Prosegui", "Continue"],
        "btn_mail_in":          ["Spedire", "Per posta", "Rispedire", "Mail"],
        "btn_return":           ["Reso", "Restituzione", "Effettua reso", "Return"],
        "btn_ship_to":          ["Consegna a", "Spedisci a", "Spedizione a", "Ship to"],
        "btn_country":          ["Paese", "Regione", "Posizione", "Cambia paese", "Country"],
        "reason_damaged":       ["Articolo arrivato danneggiato", "Danneggiato", "Articolo difettoso",
                                  "Prodotto danneggiato", "Item arrived damaged"],
        "reason_wrong_item":    ["Articolo sbagliato ricevuto", "Articolo errato",
                                  "Prodotto errato", "Wrong item received"],
        "reason_missing_parts": ["Parti mancanti", "Accessori mancanti", "Incompleto",
                                  "Missing parts"],
        "reason_not_working":   ["Articolo non funzionante", "Non conforme alla descrizione",
                                  "Difettoso", "Not working"],
        "reason_changed_mind":  ["Ho cambiato idea", "Non più necessario", "Changed my mind"],
        "reason_never_arrived": ["Pacco mai arrivato", "Non ricevuto", "Non consegnato",
                                  "Package never arrived"],
        "upload_photo":         ["carica", "aggiungi foto", "allega", "aggiungi file", "upload"],
    },

    # ── Spanish ───────────────────────────────────────────────────
    "es": {
        "btn_next":             ["Siguiente", "Continuar", "Próximo", "Next"],
        "btn_submit":           ["Enviar", "Confirmar", "Aceptar", "Submit"],
        "btn_confirm":          ["Confirmar", "OK", "Aceptar", "Confirm"],
        "btn_start_return":     ["Iniciar devolución", "Devolver artículo", "Comenzar devolución",
                                  "Hacer una devolución", "Return"],
        "btn_find":             ["Buscar", "Encontrar pedido", "Consultar", "Find"],
        "btn_continue":         ["Continuar", "Siguiente", "Avanzar", "Continue"],
        "btn_mail_in":          ["Enviar por correo", "Devolver por correo", "Mail"],
        "btn_return":           ["Devolución", "Devolver", "Gestionar devolución", "Return"],
        "btn_ship_to":          ["Enviar a", "Entregar en", "Envío a", "Ship to"],
        "btn_country":          ["País", "Región", "Ubicación", "Cambiar país", "Country"],
        "reason_damaged":       ["Artículo llegó dañado", "Dañado", "Artículo defectuoso",
                                  "Producto dañado", "Item arrived damaged"],
        "reason_wrong_item":    ["Artículo equivocado recibido", "Artículo incorrecto",
                                  "Producto incorrecto", "Wrong item received"],
        "reason_missing_parts": ["Partes faltantes", "Accesorios faltantes", "Incompleto",
                                  "Missing parts"],
        "reason_not_working":   ["El artículo no funciona", "No funciona como se describe",
                                  "Defectuoso", "Not working"],
        "reason_changed_mind":  ["Cambié de opinión", "Ya no lo necesito", "Changed my mind"],
        "reason_never_arrived": ["El paquete nunca llegó", "No recibido", "No entregado",
                                  "Package never arrived"],
        "upload_photo":         ["cargar", "añadir foto", "adjuntar", "agregar imagen", "upload"],
    },

    # ── Dutch ─────────────────────────────────────────────────────
    "nl": {
        "btn_next":             ["Volgende", "Doorgaan", "Verder", "Next"],
        "btn_submit":           ["Indienen", "Bevestigen", "Verzenden", "Submit"],
        "btn_confirm":          ["Bevestigen", "OK", "Akkoord", "Confirm"],
        "btn_start_return":     ["Retour starten", "Artikel retourneren", "Retour beginnen",
                                  "Retourzending starten", "Return"],
        "btn_find":             ["Zoeken", "Bestelling zoeken", "Opzoeken", "Find"],
        "btn_continue":         ["Doorgaan", "Volgende", "Verder gaan", "Continue"],
        "btn_mail_in":          ["Per post", "Opsturen", "Terugsturen per post", "Mail"],
        "btn_return":           ["Retour", "Terugsturen", "Retouren", "Return"],
        "btn_ship_to":          ["Verzenden naar", "Leveren aan", "Verzending naar", "Ship to"],
        "btn_country":          ["Land", "Regio", "Locatie", "Land wijzigen", "Country"],
        "reason_damaged":       ["Artikel beschadigd ontvangen", "Beschadigd", "Defect artikel",
                                  "Artikel is beschadigd", "Item arrived damaged"],
        "reason_wrong_item":    ["Verkeerd artikel ontvangen", "Onjuist artikel",
                                  "Verkeerd product", "Wrong item received"],
        "reason_missing_parts": ["Onderdelen ontbreken", "Accessoires ontbreken", "Onvolledig",
                                  "Missing parts"],
        "reason_not_working":   ["Artikel werkt niet", "Werkt niet zoals beschreven",
                                  "Defect", "Not working"],
        "reason_changed_mind":  ["Gedachten veranderd", "Niet meer nodig", "Changed my mind"],
        "reason_never_arrived": ["Pakket nooit aangekomen", "Niet ontvangen", "Niet bezorgd",
                                  "Package never arrived"],
        "upload_photo":         ["uploaden", "foto toevoegen", "bijlage toevoegen",
                                  "bestand toevoegen", "upload"],
    },

    # ── Japanese ──────────────────────────────────────────────────
    "ja": {
        "btn_next":             ["次へ", "続ける", "次のステップ", "Next"],
        "btn_submit":           ["送信", "確認", "申請する", "Submit"],
        "btn_confirm":          ["確認", "OK", "承認", "Confirm"],
        "btn_start_return":     ["返品を開始", "返品する", "返品の申請", "返品を申し込む", "Return"],
        "btn_find":             ["検索", "注文を探す", "検索する", "Find"],
        "btn_continue":         ["続ける", "次へ", "進む", "Continue"],
        "btn_mail_in":          ["郵便で送る", "返送する", "配送で返品", "Mail"],
        "btn_return":           ["返品", "返却", "返品を申請", "Return"],
        "btn_ship_to":          ["配送先", "お届け先", "Ship to"],
        "btn_country":          ["国", "地域", "場所", "国を変更", "Country"],
        "reason_damaged":       ["破損した状態で届いた", "破損品", "不良品", "商品が破損していた",
                                  "Item arrived damaged"],
        "reason_wrong_item":    ["違う商品が届いた", "誤った商品", "間違った商品",
                                  "Wrong item received"],
        "reason_missing_parts": ["部品が足りない", "付属品がない", "不完全",
                                  "Missing parts"],
        "reason_not_working":   ["商品が動作しない", "説明と異なる", "不具合がある",
                                  "Not working"],
        "reason_changed_mind":  ["気が変わった", "不要になった", "Changed my mind"],
        "reason_never_arrived": ["荷物が届かない", "未着", "配達されなかった",
                                  "Package never arrived"],
        "upload_photo":         ["アップロード", "写真を追加", "ファイルを添付", "upload"],
    },

    # ── Portuguese (Brazil) ───────────────────────────────────────
    "pt": {
        "btn_next":             ["Próximo", "Continuar", "Avançar", "Next"],
        "btn_submit":           ["Enviar", "Confirmar", "Solicitar", "Submit"],
        "btn_confirm":          ["Confirmar", "OK", "Aceitar", "Confirm"],
        "btn_start_return":     ["Iniciar devolução", "Devolver item", "Começar devolução",
                                  "Fazer devolução", "Return"],
        "btn_find":             ["Buscar", "Encontrar pedido", "Pesquisar", "Find"],
        "btn_continue":         ["Continuar", "Próximo", "Avançar", "Continue"],
        "btn_mail_in":          ["Enviar por correio", "Devolver por correio", "Mail"],
        "btn_return":           ["Devolução", "Devolver", "Solicitar devolução", "Return"],
        "btn_ship_to":          ["Enviar para", "Entregar em", "Envio para", "Ship to"],
        "btn_country":          ["País", "Região", "Local", "Alterar país", "Country"],
        "reason_damaged":       ["Item chegou danificado", "Danificado", "Item com defeito",
                                  "Produto danificado", "Item arrived damaged"],
        "reason_wrong_item":    ["Item errado recebido", "Item incorreto",
                                  "Produto incorreto", "Wrong item received"],
        "reason_missing_parts": ["Peças faltando", "Acessórios faltando", "Incompleto",
                                  "Missing parts"],
        "reason_not_working":   ["Item não funciona", "Não conforme à descrição",
                                  "Com defeito", "Not working"],
        "reason_changed_mind":  ["Mudei de ideia", "Não preciso mais", "Changed my mind"],
        "reason_never_arrived": ["Pacote nunca chegou", "Não recebi", "Não entregue",
                                  "Package never arrived"],
        "upload_photo":         ["enviar", "adicionar foto", "anexar", "adicionar arquivo", "upload"],
    },
}


# ─── Public helpers ───────────────────────────────────────────────────────────

def get_lang(region: str) -> str:
    """Return the ISO 639-1 language code for a region/country code."""
    return REGION_TO_LANG.get((region or "us").lower().strip(), "en")


def ui(region: str, key: str) -> List[str]:
    """
    Return localized UI string variants for a region + key.
    Always includes English fallbacks at the end.
    Variants are in priority order (localized first, then English).
    """
    lang = get_lang(region)
    lang_strings = UI_STRINGS.get(lang, UI_STRINGS["en"])
    en_strings = UI_STRINGS["en"]

    result: List[str] = list(lang_strings.get(key, []))

    # Append English fallbacks that aren't already in the list
    for v in en_strings.get(key, []):
        if v not in result:
            result.append(v)

    return result or [key]


def reason_key(issue_type: str, store_covers_return: bool) -> str:
    """
    Return the locale_strings reason key for the given issue type.
    E.g. "Step1" → "damaged", "DNA" → "never_arrived"
    """
    if not store_covers_return:
        return "damaged"
    mapping = {
        "Step1": "damaged",
        "EB":    "damaged",
        "DNA":   "never_arrived",
        "LIT":   "never_arrived",
    }
    return mapping.get(issue_type, "damaged")


def reason_texts(region: str, issue_type: str, store_covers_return: bool) -> List[str]:
    """
    Return a list of localized reason text variants for a given order,
    in priority order (most-localized first, English fallbacks last).
    """
    key = reason_key(issue_type, store_covers_return)
    return ui(region, f"reason_{key}")


def btn_selectors(region: str, key: str, extra_css: List[str] = None) -> List[str]:
    """
    Build a full list of Playwright CSS selectors for a localized button key.
    Generates `button:has-text(...)` and `a:has-text(...)` for each text variant,
    then appends any extra_css selectors.
    """
    texts = ui(region, key)
    selectors: List[str] = []
    for text in texts:
        selectors.append(f"button:has-text('{text}')")
    for text in texts:
        selectors.append(f"a:has-text('{text}')")
    if extra_css:
        selectors.extend(extra_css)
    return selectors


def upload_pattern(region: str) -> str:
    """
    Return a regex pattern matching photo upload button labels for the region.
    """
    import re
    texts = ui(region, "upload_photo")
    escaped = [re.escape(t) for t in texts]
    return "|".join(escaped)


# ─── Issue code aliases (multilingual Telegram command recognition) ────────────
# Maps lowercase alias → canonical English issue code.
# Allows users to send orders in their own language via Telegram.

ISSUE_CODE_ALIASES: Dict[str, str] = {
    # ── Step1 (Create Return) ─────────────────────────────────────
    "step1": "Step1",
    # Italian
    "reso": "Step1", "rientro": "Step1", "resomerce": "Step1",
    # French
    "retour": "Step1", "renvoi": "Step1",
    # German
    "retoure": "Step1", "rücksendung": "Step1", "rucksendung": "Step1",
    "rückgabe": "Step1", "ruckgabe": "Step1",
    # Spanish
    "devolucion": "Step1", "devolución": "Step1", "retorno": "Step1",
    # Dutch
    "retour_nl": "Step1", "terugzending": "Step1",
    # Portuguese
    "devolucao": "Step1", "devolução": "Step1",
    # Japanese
    "返品": "Step1",

    # ── DNA (Did Not Arrive) ──────────────────────────────────────
    "dna": "DNA",
    # Italian
    "nonarrivato": "DNA", "nonpervenuto": "DNA", "nda": "DNA",
    "nonricevuto": "DNA",
    # French
    "nonrecu": "DNA", "nonreçu": "DNA", "pasrecu": "DNA", "pasreçu": "DNA",
    "jamaisrecu": "DNA",
    # German
    "nichtangekommen": "DNA", "nichtgeliefert": "DNA", "nichtbekommen": "DNA",
    "nichterhalten": "DNA",
    # Spanish
    "nollegado": "DNA", "nollegó": "DNA", "norecibido": "DNA",
    "nollegado_es": "DNA",
    # Dutch
    "nietthuisbezorgd": "DNA", "nichtgeleverd": "DNA", "nietontvangen": "DNA",
    # Portuguese
    "naochegou": "DNA", "naorecebido": "DNA", "nãochegou": "DNA",
    # Japanese
    "未着": "DNA", "届かない": "DNA",

    # ── EB (Empty Box) ────────────────────────────────────────────
    "eb": "EB",
    # Italian
    "scatolavuota": "EB", "scatola_vuota": "EB", "boxvuota": "EB",
    # French
    "boitevide": "EB", "boîtevide": "EB", "cartonvide": "EB",
    # German
    "leerebox": "EB", "leererkarton": "EB", "leerkarton": "EB",
    "leerepackung": "EB",
    # Spanish
    "cajavacia": "EB", "cajavaciá": "EB", "cajavacias": "EB",
    # Dutch
    "legedoos": "EB", "legebak": "EB",
    # Portuguese
    "caixavazia": "EB",
    # Japanese
    "空箱": "EB",

    # ── LIT (Lost In Transit) ─────────────────────────────────────
    "lit": "LIT",
    # Italian
    "persoincorriere": "LIT", "smarritoincorriere": "LIT",
    "perdutoincorriere": "LIT",
    # French
    "perduencorreo": "LIT", "perdutransport": "LIT",
    "perduentransit": "LIT",
    # German
    "verlorenimtransport": "LIT", "verloren": "LIT",
    "verloreninzustellung": "LIT",
    # Spanish
    "perdidoencorreo": "LIT", "perdidoentransito": "LIT",
    "extraviado": "LIT",
    # Dutch
    "verloreningpost": "LIT", "verloreninpost": "LIT",
    "verloren_nl": "LIT",
    # Portuguese
    "perdidoentransporte": "LIT", "perdidonocorreiro": "LIT",
    # Japanese
    "配送中紛失": "LIT", "配送中に紛失": "LIT",

    # ── Step2 (Return Not Processed) ─────────────────────────────
    "step2": "Step2",
    # Italian
    "resonoelaborato": "Step2", "rimborsononricevuto": "Step2",
    # French
    "retournontraite": "Step2", "remboursementenattente": "Step2",
    # German
    "retourenicbtbearbeitet": "Step2", "rückerstattung": "Step2",
    "ruckerstattung": "Step2",
    # Spanish
    "devolucionnotratada": "Step2", "reembolsopendiente": "Step2",
    # Portuguese
    "devolucaonaotratada": "Step2",

    # ── Followup ──────────────────────────────────────────────────
    "followup": "Followup", "follow-up": "Followup", "follow_up": "Followup",
    # Italian
    "followup_it": "Followup", "controllare": "Followup",
    # French
    "suivi": "Followup",
    # German
    "nachverfolgung": "Followup", "nf": "Followup",
    # Spanish
    "seguimiento": "Followup",
    # Dutch
    "opvolging": "Followup",
    # Portuguese
    "seguimento": "Followup",
    # Japanese
    "フォローアップ": "Followup",
}


def normalize_issue_code(raw: str) -> str:
    """
    Normalize a raw issue code token (from Telegram message) to its canonical form.
    Handles all multilingual aliases. Returns the canonical code or the raw uppercased
    string if no match found.
    """
    clean = raw.lower().strip()
    # Direct alias lookup
    if clean in ISSUE_CODE_ALIASES:
        return ISSUE_CODE_ALIASES[clean]
    # Remove accents and retry (simple normalization)
    import unicodedata
    normalized = unicodedata.normalize("NFD", clean)
    ascii_only = "".join(c for c in normalized if unicodedata.category(c) != "Mn")
    if ascii_only in ISSUE_CODE_ALIASES:
        return ISSUE_CODE_ALIASES[ascii_only]
    return raw


# ─── HTML lang attribute normalisation ───────────────────────────────────────
# Maps HTML lang codes (BCP 47) to our 2-letter ISO 639-1 language codes.

HTML_LANG_TO_LANG: Dict[str, str] = {
    "en": "en", "en-us": "en", "en-gb": "en", "en-au": "en",
    "en-ca": "en", "en-in": "en",
    "de": "de", "de-de": "de", "de-at": "de", "de-ch": "de",
    "fr": "fr", "fr-fr": "fr", "fr-be": "fr", "fr-ch": "fr",
    "fr-ca": "fr",
    "it": "it", "it-it": "it", "it-ch": "it",
    "es": "es", "es-es": "es", "es-mx": "es", "es-ar": "es",
    "es-co": "es", "es-419": "es",
    "nl": "nl", "nl-nl": "nl", "nl-be": "nl",
    "ja": "ja", "ja-jp": "ja",
    "pt": "pt", "pt-br": "pt", "pt-pt": "pt",
}


def normalize_html_lang(lang_attr: str) -> str:
    """
    Convert an HTML lang attribute value to our ISO 639-1 language code.
    E.g. 'de-DE' → 'de', 'en-US' → 'en', 'fr' → 'fr'
    Returns 'en' if not recognized.
    """
    if not lang_attr:
        return "en"
    cleaned = lang_attr.lower().strip()
    if cleaned in HTML_LANG_TO_LANG:
        return HTML_LANG_TO_LANG[cleaned]
    # Try prefix match (e.g. 'zh-Hant-TW' → check 'zh')
    prefix = cleaned.split("-")[0]
    return HTML_LANG_TO_LANG.get(prefix, "en")


# ─── Language detection from free text ───────────────────────────────────────
# Used to detect the language an agent writes in during live chat.
# Uses simple heuristic patterns — common high-frequency words per language.

_LANG_MARKERS: Dict[str, List[str]] = {
    "de": [
        "danke", "bitte", "hallo", "guten", "entschuldigung", "ich", "sie",
        "haben", "können", "leider", "natürlich", "verstanden", "gerne",
        "herzlich", "willkommen", "hilfe", "bestellung", "rücksendung",
    ],
    "fr": [
        "bonjour", "merci", "désolé", "votre", "commande", "nous", "pouvez",
        "malheureusement", "bien", "cordialement", "retour", "livraison",
        "notre", "service", "équipe",
    ],
    "it": [
        "buongiorno", "grazie", "scusi", "ordine", "prego", "nostro", "sua",
        "può", "siamo", "purtroppo", "capisco", "certamente", "reso",
        "spedizione",
    ],
    "es": [
        "hola", "gracias", "lo siento", "disculpe", "pedido", "nuestro",
        "puede", "lamentablemente", "entendido", "claro", "devolución",
        "envío", "estimado",
    ],
    "nl": [
        "hallo", "bedankt", "sorry", "begrijp", "bestelling", "ons", "kunt",
        "helaas", "zeker", "vriendelijk", "retour", "levering", "graag",
    ],
    "ja": [
        "こんにちは", "ありがとう", "申し訳", "ございます", "ご注文",
        "確認", "対応", "いたします", "お問い合わせ", "返品",
    ],
    "pt": [
        "olá", "obrigado", "desculpe", "pedido", "nosso", "pode",
        "infelizmente", "entendido", "claro", "devolução", "entrega",
    ],
}


def detect_language_from_text(text: str) -> str:
    """
    Detect the language of a text string using keyword heuristics.
    Returns an ISO 639-1 language code ('en', 'de', 'fr', etc.).
    Falls back to 'en' if no clear match.
    """
    if not text:
        return "en"
    # Japanese: check for CJK characters first
    if any("\u3040" <= c <= "\u30ff" or "\u4e00" <= c <= "\u9fff" for c in text):
        return "ja"
    text_lower = text.lower()
    scores: Dict[str, int] = {}
    for lang, markers in _LANG_MARKERS.items():
        score = sum(1 for m in markers if m in text_lower)
        if score > 0:
            scores[lang] = score
    if not scores:
        return "en"
    return max(scores, key=lambda k: scores[k])


# ─── Live chat scripts ────────────────────────────────────────────────────────
# Canned messages for common live chat flows, keyed by language and script key.
# {lang: {script_key: message_template}}
# Template variables: {order_number}, {merchant}, {item_description}

LIVE_CHAT_SCRIPTS: Dict[str, Dict[str, str]] = {

    "en": {
        "greeting":         "Hi, I need help with my order.",
        "dna_opening":      "Hello, I placed an order ({order_number}) and it has not arrived yet. Could you please help me resolve this?",
        "dna_follow":       "I have been waiting for a long time and the tracking shows no movement. I would like a full refund please.",
        "eb_opening":       "Hi, I received my order ({order_number}) but the box was completely empty. I did not receive the item I ordered.",
        "eb_follow":        "I would like a replacement or a full refund for the empty box I received.",
        "step1_opening":    "Hello, I would like to return my order ({order_number}). The item arrived damaged.",
        "step1_follow":     "Please help me start the return process. I would like a prepaid return label.",
        "step2_opening":    "Hello, I submitted a return for order ({order_number}) some time ago but it has not been processed yet. Could you please check the status and process my refund?",
        "lit_opening":      "Hello, my order ({order_number}) appears to have been lost in transit. The tracking has not updated in a long time.",
        "lit_follow":       "I would like a replacement or a full refund for the lost order.",
        "request_refund":   "I would like a full refund for this order, please.",
        "request_replace":  "I would like a replacement sent as soon as possible, please.",
        "request_label":    "Could you please send me a prepaid return label?",
        "ask_supervisor":   "Could I please speak with a supervisor?",
        "provide_order":    "My order number is {order_number}.",
        "provide_email":    "The email on the order is {customer_email}.",
        "thank_you":        "Thank you for your help. Have a great day!",
        "escalate":         "I am not satisfied with this resolution. I would like to escalate this matter.",
    },

    "de": {
        "greeting":         "Hallo, ich benötige Hilfe bei meiner Bestellung.",
        "dna_opening":      "Guten Tag, ich habe eine Bestellung aufgegeben ({order_number}), die jedoch noch nicht angekommen ist. Können Sie mir bitte helfen?",
        "dna_follow":       "Ich warte schon sehr lange und das Tracking zeigt keine Bewegung. Ich möchte bitte eine vollständige Rückerstattung.",
        "eb_opening":       "Hallo, ich habe meine Bestellung ({order_number}) erhalten, aber der Karton war komplett leer. Der bestellte Artikel fehlte.",
        "eb_follow":        "Ich möchte einen Ersatz oder eine vollständige Rückerstattung für den leeren Karton.",
        "step1_opening":    "Guten Tag, ich möchte meine Bestellung ({order_number}) zurücksenden. Der Artikel ist beschädigt angekommen.",
        "step1_follow":     "Bitte helfen Sie mir, den Rücksendeprozess zu starten. Ich benötige ein frankiertes Rücksendeetikett.",
        "lit_opening":      "Hallo, meine Bestellung ({order_number}) scheint während des Transports verloren gegangen zu sein. Das Tracking wurde seit Langem nicht aktualisiert.",
        "lit_follow":       "Ich möchte einen Ersatz oder eine vollständige Rückerstattung für die verlorene Bestellung.",
        "request_refund":   "Ich möchte bitte eine vollständige Rückerstattung für diese Bestellung.",
        "request_replace":  "Ich möchte bitte so schnell wie möglich einen Ersatz erhalten.",
        "request_label":    "Könnten Sie mir bitte ein frankiertes Rücksendeetikett zusenden?",
        "ask_supervisor":   "Könnte ich bitte mit einem Vorgesetzten sprechen?",
        "provide_order":    "Meine Bestellnummer lautet {order_number}.",
        "provide_email":    "Die E-Mail-Adresse der Bestellung ist {customer_email}.",
        "thank_you":        "Vielen Dank für Ihre Hilfe. Einen schönen Tag noch!",
        "escalate":         "Ich bin mit dieser Lösung nicht zufrieden. Ich möchte diese Angelegenheit eskalieren.",
    },

    "fr": {
        "greeting":         "Bonjour, j'ai besoin d'aide avec ma commande.",
        "dna_opening":      "Bonjour, j'ai passé une commande ({order_number}) qui n'est pas encore arrivée. Pourriez-vous m'aider à résoudre ce problème ?",
        "dna_follow":       "J'attends depuis longtemps et le suivi ne montre aucun mouvement. Je souhaite un remboursement complet.",
        "eb_opening":       "Bonjour, j'ai reçu ma commande ({order_number}) mais le colis était entièrement vide. Je n'ai pas reçu l'article commandé.",
        "eb_follow":        "Je souhaite un remplacement ou un remboursement complet pour le colis vide reçu.",
        "step1_opening":    "Bonjour, je souhaite retourner ma commande ({order_number}). L'article est arrivé endommagé.",
        "step1_follow":     "Veuillez m'aider à démarrer le processus de retour. J'ai besoin d'une étiquette de retour prépayée.",
        "lit_opening":      "Bonjour, ma commande ({order_number}) semble avoir été perdue en transit. Le suivi n'a pas été mis à jour depuis longtemps.",
        "lit_follow":       "Je souhaite un remplacement ou un remboursement complet pour la commande perdue.",
        "request_refund":   "Je souhaite un remboursement complet pour cette commande, s'il vous plaît.",
        "request_replace":  "Je souhaite un remplacement envoyé dès que possible, s'il vous plaît.",
        "request_label":    "Pourriez-vous m'envoyer une étiquette de retour prépayée ?",
        "ask_supervisor":   "Puis-je parler à un responsable, s'il vous plaît ?",
        "provide_order":    "Mon numéro de commande est {order_number}.",
        "provide_email":    "L'e-mail associé à la commande est {customer_email}.",
        "thank_you":        "Merci pour votre aide. Bonne journée !",
        "escalate":         "Je ne suis pas satisfait(e) de cette solution. Je souhaite escalader ce problème.",
    },

    "it": {
        "greeting":         "Buongiorno, ho bisogno di assistenza per il mio ordine.",
        "dna_opening":      "Buongiorno, ho effettuato un ordine ({order_number}) che non è ancora arrivato. Potreste aiutarmi a risolvere questo problema?",
        "dna_follow":       "Aspetto da molto tempo e il tracciamento non mostra movimenti. Vorrei un rimborso completo.",
        "eb_opening":       "Salve, ho ricevuto il mio ordine ({order_number}) ma la scatola era completamente vuota. Non ho ricevuto l'articolo ordinato.",
        "eb_follow":        "Vorrei una sostituzione o un rimborso completo per la scatola vuota ricevuta.",
        "step1_opening":    "Buongiorno, vorrei restituire il mio ordine ({order_number}). L'articolo è arrivato danneggiato.",
        "step1_follow":     "Per favore aiutatemi ad avviare la procedura di reso. Ho bisogno di un'etichetta di reso prepagata.",
        "lit_opening":      "Salve, il mio ordine ({order_number}) sembra perso durante il trasporto. Il tracciamento non si aggiorna da molto tempo.",
        "lit_follow":       "Vorrei una sostituzione o un rimborso completo per l'ordine perso.",
        "request_refund":   "Vorrei un rimborso completo per questo ordine, per favore.",
        "request_replace":  "Vorrei che un articolo sostitutivo venisse inviato il prima possibile.",
        "request_label":    "Potreste inviarmi un'etichetta di reso prepagata?",
        "ask_supervisor":   "Potrei parlare con un responsabile, per favore?",
        "provide_order":    "Il mio numero d'ordine è {order_number}.",
        "provide_email":    "L'e-mail dell'ordine è {customer_email}.",
        "thank_you":        "Grazie per l'assistenza. Buona giornata!",
        "escalate":         "Non sono soddisfatto/a di questa soluzione. Vorrei escalare questa questione.",
    },

    "es": {
        "greeting":         "Hola, necesito ayuda con mi pedido.",
        "dna_opening":      "Hola, realicé un pedido ({order_number}) que todavía no ha llegado. ¿Podrían ayudarme a resolver esto?",
        "dna_follow":       "Llevo esperando mucho tiempo y el seguimiento no muestra movimiento. Me gustaría un reembolso completo.",
        "eb_opening":       "Hola, recibí mi pedido ({order_number}) pero la caja estaba completamente vacía. No recibí el artículo que pedí.",
        "eb_follow":        "Me gustaría un reemplazo o un reembolso completo por la caja vacía que recibí.",
        "step1_opening":    "Hola, me gustaría devolver mi pedido ({order_number}). El artículo llegó dañado.",
        "step1_follow":     "Por favor, ayúdenme a iniciar el proceso de devolución. Necesito una etiqueta de devolución prepagada.",
        "lit_opening":      "Hola, mi pedido ({order_number}) parece haberse perdido durante el transporte. El seguimiento no se ha actualizado desde hace mucho.",
        "lit_follow":       "Me gustaría un reemplazo o un reembolso completo por el pedido perdido.",
        "request_refund":   "Me gustaría un reembolso completo por este pedido, por favor.",
        "request_replace":  "Me gustaría que me envíen un reemplazo lo antes posible, por favor.",
        "request_label":    "¿Podrían enviarme una etiqueta de devolución prepagada?",
        "ask_supervisor":   "¿Podría hablar con un supervisor, por favor?",
        "provide_order":    "Mi número de pedido es {order_number}.",
        "provide_email":    "El correo del pedido es {customer_email}.",
        "thank_you":        "Gracias por su ayuda. ¡Que tenga un buen día!",
        "escalate":         "No estoy satisfecho/a con esta solución. Me gustaría escalar este asunto.",
    },

    "nl": {
        "greeting":         "Hallo, ik heb hulp nodig bij mijn bestelling.",
        "dna_opening":      "Hallo, ik heb een bestelling geplaatst ({order_number}) die nog niet is aangekomen. Kunt u mij helpen dit op te lossen?",
        "dna_follow":       "Ik wacht al erg lang en de tracking toont geen beweging. Ik zou graag een volledige terugbetaling willen.",
        "eb_opening":       "Hallo, ik heb mijn bestelling ({order_number}) ontvangen maar de doos was volledig leeg. Ik heb het bestelde artikel niet ontvangen.",
        "eb_follow":        "Ik zou graag een vervanging of een volledige terugbetaling willen voor de lege doos.",
        "step1_opening":    "Hallo, ik wil mijn bestelling ({order_number}) retourneren. Het artikel is beschadigd aangekomen.",
        "step1_follow":     "Kunt u mij helpen het retourproces te starten? Ik heb een prepaid retourlabel nodig.",
        "lit_opening":      "Hallo, mijn bestelling ({order_number}) lijkt verloren te zijn gegaan tijdens het transport. De tracking is al lang niet bijgewerkt.",
        "lit_follow":       "Ik zou graag een vervanging of een volledige terugbetaling willen voor de verloren bestelling.",
        "request_refund":   "Ik zou graag een volledige terugbetaling voor deze bestelling willen.",
        "request_replace":  "Ik zou graag zo snel mogelijk een vervangend artikel willen ontvangen.",
        "request_label":    "Kunt u mij een prepaid retourlabel sturen?",
        "ask_supervisor":   "Mag ik een supervisor spreken, alstublieft?",
        "provide_order":    "Mijn bestelnummer is {order_number}.",
        "provide_email":    "Het e-mailadres van de bestelling is {customer_email}.",
        "thank_you":        "Bedankt voor uw hulp. Fijne dag nog!",
        "escalate":         "Ik ben niet tevreden met deze oplossing. Ik wil dit escaleren.",
    },

    "ja": {
        "greeting":         "こんにちは。注文について助けていただけますか。",
        "dna_opening":      "こんにちは。注文（{order_number}）がまだ届いていません。解決にご協力いただけますか。",
        "dna_follow":       "長い間待っていますが、追跡情報が更新されていません。全額返金をお願いします。",
        "eb_opening":       "こんにちは。注文（{order_number}）が届きましたが、箱が空でした。注文した商品が入っていませんでした。",
        "eb_follow":        "空の箱に対して、交換品または全額返金をお願いします。",
        "step1_opening":    "こんにちは。注文（{order_number}）を返品したいです。商品が破損した状態で届きました。",
        "step1_follow":     "返品手続きを開始するお手伝いをお願いします。着払いの返送ラベルが必要です。",
        "lit_opening":      "こんにちは。注文（{order_number}）が配送中に紛失したようです。追跡情報が長い間更新されていません。",
        "lit_follow":       "紛失した注文について、交換品または全額返金をお願いします。",
        "request_refund":   "この注文について全額返金をお願いします。",
        "request_replace":  "できるだけ早く交換品を送っていただけますか。",
        "request_label":    "着払いの返送ラベルを送っていただけますか。",
        "ask_supervisor":   "責任者に繋いでいただけますか。",
        "provide_order":    "注文番号は {order_number} です。",
        "provide_email":    "注文のメールアドレスは {customer_email} です。",
        "thank_you":        "ご対応ありがとうございました。",
        "escalate":         "この対応に満足しておりません。エスカレーションをお願いします。",
    },

    "pt": {
        "greeting":         "Olá, preciso de ajuda com meu pedido.",
        "dna_opening":      "Olá, fiz um pedido ({order_number}) que ainda não chegou. Vocês poderiam me ajudar a resolver isso?",
        "dna_follow":       "Estou esperando há muito tempo e o rastreamento não mostra movimento. Gostaria de um reembolso completo.",
        "eb_opening":       "Olá, recebi meu pedido ({order_number}), mas a caixa estava completamente vazia. Não recebi o item que pedi.",
        "eb_follow":        "Gostaria de um produto substituto ou um reembolso completo pela caixa vazia que recebi.",
        "step1_opening":    "Olá, gostaria de devolver meu pedido ({order_number}). O item chegou danificado.",
        "step1_follow":     "Por favor, me ajude a iniciar o processo de devolução. Preciso de uma etiqueta de devolução pré-paga.",
        "lit_opening":      "Olá, meu pedido ({order_number}) parece ter se perdido durante o transporte. O rastreamento não é atualizado há muito tempo.",
        "lit_follow":       "Gostaria de um produto substituto ou um reembolso completo pelo pedido perdido.",
        "request_refund":   "Gostaria de um reembolso completo para este pedido, por favor.",
        "request_replace":  "Gostaria que um substituto fosse enviado o mais rápido possível, por favor.",
        "request_label":    "Vocês poderiam me enviar uma etiqueta de devolução pré-paga?",
        "ask_supervisor":   "Poderia falar com um supervisor, por favor?",
        "provide_order":    "Meu número de pedido é {order_number}.",
        "provide_email":    "O e-mail do pedido é {customer_email}.",
        "thank_you":        "Obrigado pela ajuda. Tenha um ótimo dia!",
        "escalate":         "Não estou satisfeito com esta resolução. Gostaria de escalar este assunto.",
    },
}


# ─── Followup scripts (per original issue type) ───────────────────────────────
# Keyed by {lang: {original_issue_code_lower: message_template}}.
# Used when issue_type == "Followup" and the original issue code is known.

FOLLOWUP_SCRIPTS: Dict[str, Dict[str, str]] = {
    "en": {
        "dna":     "Hi, I'm following up on my inquiry about order {order_number} which I reported as not having arrived. Could you please update me on the status?",
        "lit":     "Hi, I'm following up on order {order_number} which I reported as lost in transit. Could you please provide an update?",
        "eb":      "Hi, I'm following up on order {order_number} regarding the empty box I received. Has this been resolved yet?",
        "step1":   "Hi, I'm following up on the return I initiated for order {order_number}. Could you confirm the status of my return and refund?",
        "step2":   "Hi, I'm following up on a return for order {order_number} that I submitted but has not been processed yet. Could you please look into this?",
        "generic": "Hi, I'm following up on my previous inquiry regarding order {order_number}. Could you please provide an update?",
    },
    "de": {
        "dna":     "Hallo, ich möchte nachfragen bezüglich meiner Bestellung {order_number}, die ich als nicht angekommen gemeldet habe. Können Sie mir bitte den aktuellen Stand mitteilen?",
        "lit":     "Hallo, ich möchte nachfragen bezüglich Bestellung {order_number}, die als auf dem Transportweg verloren gemeldet wurde. Gibt es einen aktuellen Stand?",
        "eb":      "Hallo, ich möchte nachfragen bezüglich der leeren Verpackung, die ich für Bestellung {order_number} erhalten habe. Wurde das Problem bereits gelöst?",
        "step1":   "Hallo, ich möchte nach meiner Rücksendung für Bestellung {order_number} nachfragen. Können Sie mir bitte den Status der Rücksendung und Rückerstattung bestätigen?",
        "step2":   "Hallo, ich möchte nach meiner Rücksendung für Bestellung {order_number} nachfragen, die ich eingereicht habe, aber noch nicht bearbeitet wurde. Können Sie das bitte prüfen?",
        "generic": "Hallo, ich möchte bezüglich Bestellung {order_number} nachfragen. Können Sie mir bitte einen aktuellen Stand geben?",
    },
    "fr": {
        "dna":     "Bonjour, je fais un suivi concernant ma commande {order_number} que j'ai signalée comme non reçue. Pourriez-vous me donner une mise à jour ?",
        "lit":     "Bonjour, je fais un suivi concernant la commande {order_number} signalée comme perdue en transit. Y a-t-il des nouvelles ?",
        "eb":      "Bonjour, je fais un suivi concernant le colis vide reçu pour la commande {order_number}. Ce problème a-t-il été résolu ?",
        "step1":   "Bonjour, je fais un suivi du retour que j'ai initié pour la commande {order_number}. Pouvez-vous confirmer le statut de mon retour et de mon remboursement ?",
        "step2":   "Bonjour, je fais un suivi d'un retour pour la commande {order_number} que j'ai soumis mais qui n'a pas encore été traité. Pouvez-vous vérifier cela ?",
        "generic": "Bonjour, je fais un suivi concernant ma demande précédente pour la commande {order_number}. Pouvez-vous me donner une mise à jour ?",
    },
    "it": {
        "dna":     "Buongiorno, mi ricollego alla mia segnalazione per l'ordine {order_number} che ho riferito come non arrivato. Può aggiornarmi sullo stato?",
        "lit":     "Buongiorno, mi ricollego all'ordine {order_number} segnalato come perso durante il trasporto. Ci sono aggiornamenti?",
        "eb":      "Buongiorno, mi ricollego alla questione della scatola vuota ricevuta per l'ordine {order_number}. Il problema è stato risolto?",
        "step1":   "Buongiorno, mi ricollego al reso avviato per l'ordine {order_number}. Può confermare lo stato del reso e del rimborso?",
        "step2":   "Buongiorno, mi ricollego al reso per l'ordine {order_number} che ho inviato ma che non è ancora stato elaborato. Può controllare?",
        "generic": "Buongiorno, mi ricollego alla mia precedente richiesta riguardante l'ordine {order_number}. Può aggiornarmi?",
    },
    "es": {
        "dna":     "Hola, estoy haciendo seguimiento de mi consulta sobre el pedido {order_number} que reporté como no recibido. ¿Podría darme una actualización?",
        "lit":     "Hola, estoy haciendo seguimiento del pedido {order_number} reportado como perdido en tránsito. ¿Hay alguna novedad?",
        "eb":      "Hola, estoy haciendo seguimiento sobre la caja vacía que recibí para el pedido {order_number}. ¿Se ha resuelto el problema?",
        "step1":   "Hola, estoy haciendo seguimiento de la devolución que inicié para el pedido {order_number}. ¿Puede confirmarme el estado de mi devolución y reembolso?",
        "step2":   "Hola, estoy haciendo seguimiento de una devolución del pedido {order_number} que envié pero que aún no ha sido procesada. ¿Podría verificarlo?",
        "generic": "Hola, estoy haciendo seguimiento de mi consulta anterior sobre el pedido {order_number}. ¿Podría darme una actualización?",
    },
    "nl": {
        "dna":     "Hallo, ik wil graag een follow-up doen op mijn melding over bestelling {order_number} die ik heb gemeld als niet aangekomen. Kunt u mij een update geven?",
        "lit":     "Hallo, ik wil graag een follow-up doen op bestelling {order_number} die gemeld is als verloren tijdens het transport. Is er nieuws?",
        "eb":      "Hallo, ik wil graag een follow-up doen op de lege doos die ik ontving voor bestelling {order_number}. Is dit probleem al opgelost?",
        "step1":   "Hallo, ik wil graag een follow-up doen op de retour die ik heb geïnitieerd voor bestelling {order_number}. Kunt u de status van mijn retour en terugbetaling bevestigen?",
        "step2":   "Hallo, ik wil graag een follow-up doen op een retour voor bestelling {order_number} die ik heb ingediend maar nog niet is verwerkt. Kunt u dit nakijken?",
        "generic": "Hallo, ik wil graag een follow-up doen op mijn vorige vraag over bestelling {order_number}. Kunt u mij een update geven?",
    },
    "ja": {
        "dna":     "こんにちは。以前にご連絡した注文（{order_number}）の未着について、その後の状況を確認させてください。",
        "lit":     "こんにちは。配送中に紛失と報告した注文（{order_number}）についてフォローアップしています。最新の状況を教えていただけますか。",
        "eb":      "こんにちは。注文（{order_number}）の空の箱についてフォローアップしています。問題は解決しましたか。",
        "step1":   "こんにちは。注文（{order_number}）の返品手続きについてフォローアップしています。返品と返金の状況を確認できますか。",
        "step2":   "こんにちは。申請した返品（注文{order_number}）がまだ処理されていないためフォローアップしています。確認いただけますか。",
        "generic": "こんにちは。注文（{order_number}）に関する以前のお問い合わせについてフォローアップしています。状況を教えていただけますか。",
    },
    "pt": {
        "dna":     "Olá, estou fazendo um acompanhamento da minha consulta sobre o pedido {order_number} que reportei como não recebido. Poderia me dar uma atualização?",
        "lit":     "Olá, estou fazendo um acompanhamento do pedido {order_number} reportado como perdido durante o transporte. Há alguma novidade?",
        "eb":      "Olá, estou fazendo um acompanhamento sobre a caixa vazia que recebi para o pedido {order_number}. O problema foi resolvido?",
        "step1":   "Olá, estou fazendo um acompanhamento da devolução que iniciei para o pedido {order_number}. Pode confirmar o status da devolução e do reembolso?",
        "step2":   "Olá, estou fazendo um acompanhamento de uma devolução do pedido {order_number} que enviei mas ainda não foi processada. Poderia verificar isso?",
        "generic": "Olá, estou fazendo um acompanhamento da minha consulta anterior sobre o pedido {order_number}. Poderia me dar uma atualização?",
    },
}


def live_chat_script(lang: str, key: str, **kwargs) -> str:
    """
    Return a canned live chat message in the given language.
    Falls back to English if the language or key is not found.
    Template variables in kwargs are substituted (e.g. order_number='123').
    """
    scripts = LIVE_CHAT_SCRIPTS.get(lang, LIVE_CHAT_SCRIPTS["en"])
    template = scripts.get(key, LIVE_CHAT_SCRIPTS["en"].get(key, ""))
    if kwargs:
        try:
            return template.format(**kwargs)
        except KeyError:
            pass
    return template


def followup_script(lang: str, original_issue_type: str, **kwargs) -> str:
    """
    Return a followup opening message in the given language for a specific
    original issue type. Falls back to English, then to the generic followup.
    Template variables in kwargs are substituted (e.g. order_number='123').
    """
    orig_key = original_issue_type.lower() if original_issue_type else "generic"
    scripts = FOLLOWUP_SCRIPTS.get(lang, FOLLOWUP_SCRIPTS["en"])
    template = scripts.get(orig_key, scripts.get("generic", ""))
    if not template:
        en_scripts = FOLLOWUP_SCRIPTS["en"]
        template = en_scripts.get(orig_key, en_scripts.get("generic", ""))
    if kwargs:
        try:
            return template.format(**kwargs)
        except KeyError:
            pass
    return template


def issue_type_to_chat_key(issue_type: str, original_type: str = "") -> str:
    """
    Map an order issue type to the live chat opening script key.
    For Followup orders, returns a sentinel value "__followup__" so the caller
    knows to use followup_script() instead of live_chat_script().
    """
    if issue_type == "Followup":
        return "__followup__"
    return {
        "Step1": "step1_opening",
        "EB":    "eb_opening",
        "DNA":   "dna_opening",
        "LIT":   "lit_opening",
        "Step2": "step2_opening",
    }.get(issue_type, "greeting")
