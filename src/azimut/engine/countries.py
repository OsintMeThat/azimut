"""ISO 3166-1 alpha-2 → English country name, as a static table.

Nominatim answers in the local language, so a case filed across three countries
comes back as ``Россия`` / ``Deutschland`` / ``中国``. The Saved tree wants an
English name beside the native one, and for countries there is no reason to ask
a geocoder for it: the country code is already stored, so the English name is
derived on read exactly the way the continent is. Correcting this table repairs
every existing case at once — no migration, no re-geocoding, no network.

Regions have no such table and are looked up (see ``geo.locate_point``).

The names are the common English short forms, not the ISO long forms: this is a
label to scan in a 300px panel, not a diplomatic register.
"""

from __future__ import annotations

COUNTRY_NAMES_EN: dict[str, str] = {
    # Africa
    "ao": "Angola", "bf": "Burkina Faso", "bi": "Burundi", "bj": "Benin",
    "bw": "Botswana", "cd": "DR Congo", "cf": "Central African Republic",
    "cg": "Republic of the Congo", "ci": "Ivory Coast", "cm": "Cameroon",
    "cv": "Cape Verde", "dj": "Djibouti", "dz": "Algeria", "eg": "Egypt",
    "eh": "Western Sahara", "er": "Eritrea", "et": "Ethiopia", "ga": "Gabon",
    "gh": "Ghana", "gm": "Gambia", "gn": "Guinea", "gq": "Equatorial Guinea",
    "gw": "Guinea-Bissau", "ke": "Kenya", "km": "Comoros", "ls": "Lesotho",
    "lr": "Liberia", "ly": "Libya", "ma": "Morocco", "mg": "Madagascar",
    "ml": "Mali", "mr": "Mauritania", "mu": "Mauritius", "mw": "Malawi",
    "mz": "Mozambique", "na": "Namibia", "ne": "Niger", "ng": "Nigeria",
    "re": "Réunion", "rw": "Rwanda", "sc": "Seychelles", "sd": "Sudan",
    "sh": "Saint Helena", "sl": "Sierra Leone", "sn": "Senegal",
    "so": "Somalia", "ss": "South Sudan", "st": "São Tomé and Príncipe",
    "sz": "Eswatini", "td": "Chad", "tg": "Togo", "tn": "Tunisia",
    "tz": "Tanzania", "ug": "Uganda", "yt": "Mayotte", "za": "South Africa",
    "zm": "Zambia", "zw": "Zimbabwe",
    # Antarctica
    "aq": "Antarctica", "bv": "Bouvet Island",
    "gs": "South Georgia and the South Sandwich Islands",
    "hm": "Heard Island and McDonald Islands",
    "tf": "French Southern Territories",
    # Asia
    "ae": "United Arab Emirates", "af": "Afghanistan", "am": "Armenia",
    "az": "Azerbaijan", "bd": "Bangladesh", "bh": "Bahrain", "bn": "Brunei",
    "bt": "Bhutan", "cc": "Cocos (Keeling) Islands", "cn": "China",
    "cx": "Christmas Island", "cy": "Cyprus", "ge": "Georgia",
    "hk": "Hong Kong", "id": "Indonesia", "il": "Israel", "in": "India",
    "io": "British Indian Ocean Territory", "iq": "Iraq", "ir": "Iran",
    "jo": "Jordan", "jp": "Japan", "kg": "Kyrgyzstan", "kh": "Cambodia",
    "kp": "North Korea", "kr": "South Korea", "kw": "Kuwait",
    "kz": "Kazakhstan", "la": "Laos", "lb": "Lebanon", "lk": "Sri Lanka",
    "mm": "Myanmar", "mn": "Mongolia", "mo": "Macao", "mv": "Maldives",
    "my": "Malaysia", "np": "Nepal", "om": "Oman", "ph": "Philippines",
    "pk": "Pakistan", "ps": "Palestine", "qa": "Qatar", "sa": "Saudi Arabia",
    "sg": "Singapore", "sy": "Syria", "th": "Thailand", "tj": "Tajikistan",
    "tl": "Timor-Leste", "tm": "Turkmenistan", "tr": "Turkey", "tw": "Taiwan",
    "uz": "Uzbekistan", "vn": "Vietnam", "ye": "Yemen",
    # Europe
    "ad": "Andorra", "al": "Albania", "at": "Austria", "ax": "Åland Islands",
    "ba": "Bosnia and Herzegovina", "be": "Belgium", "bg": "Bulgaria",
    "by": "Belarus", "ch": "Switzerland", "cz": "Czechia", "de": "Germany",
    "dk": "Denmark", "ee": "Estonia", "es": "Spain", "fi": "Finland",
    "fo": "Faroe Islands", "fr": "France", "gb": "United Kingdom",
    "gg": "Guernsey", "gi": "Gibraltar", "gr": "Greece", "hr": "Croatia",
    "hu": "Hungary", "ie": "Ireland", "im": "Isle of Man", "is": "Iceland",
    "it": "Italy", "je": "Jersey", "li": "Liechtenstein", "lt": "Lithuania",
    "lu": "Luxembourg", "lv": "Latvia", "mc": "Monaco", "md": "Moldova",
    "me": "Montenegro", "mk": "North Macedonia", "mt": "Malta",
    "nl": "Netherlands", "no": "Norway", "pl": "Poland", "pt": "Portugal",
    "ro": "Romania", "rs": "Serbia", "ru": "Russia", "se": "Sweden",
    "si": "Slovenia", "sj": "Svalbard and Jan Mayen", "sk": "Slovakia",
    "sm": "San Marino", "ua": "Ukraine", "va": "Vatican City",
    # Kosovo has no continent verdict (it is not in the UN geoscheme table),
    # but Nominatim files points there under "xk" and the name is still useful.
    "xk": "Kosovo",
    # North America
    "ag": "Antigua and Barbuda", "ai": "Anguilla", "aw": "Aruba",
    "bb": "Barbados", "bl": "Saint Barthélemy", "bm": "Bermuda",
    "bq": "Caribbean Netherlands", "bs": "Bahamas", "bz": "Belize",
    "ca": "Canada", "cr": "Costa Rica", "cu": "Cuba", "cw": "Curaçao",
    "dm": "Dominica", "do": "Dominican Republic", "gd": "Grenada",
    "gl": "Greenland", "gp": "Guadeloupe", "gt": "Guatemala",
    "hn": "Honduras", "ht": "Haiti", "jm": "Jamaica",
    "kn": "Saint Kitts and Nevis", "ky": "Cayman Islands", "lc": "Saint Lucia",
    "mf": "Saint Martin", "mq": "Martinique", "ms": "Montserrat",
    "mx": "Mexico", "ni": "Nicaragua", "pa": "Panama",
    "pm": "Saint Pierre and Miquelon", "pr": "Puerto Rico",
    "sv": "El Salvador", "sx": "Sint Maarten",
    "tc": "Turks and Caicos Islands", "tt": "Trinidad and Tobago",
    "us": "United States", "vc": "Saint Vincent and the Grenadines",
    "vg": "British Virgin Islands", "vi": "United States Virgin Islands",
    # Oceania
    "as": "American Samoa", "au": "Australia", "ck": "Cook Islands",
    "fj": "Fiji", "fm": "Micronesia", "gu": "Guam", "ki": "Kiribati",
    "mh": "Marshall Islands", "mp": "Northern Mariana Islands",
    "nc": "New Caledonia", "nf": "Norfolk Island", "nr": "Nauru",
    "nu": "Niue", "nz": "New Zealand", "pf": "French Polynesia",
    "pg": "Papua New Guinea", "pn": "Pitcairn Islands", "pw": "Palau",
    "sb": "Solomon Islands", "tk": "Tokelau", "to": "Tonga", "tv": "Tuvalu",
    "um": "United States Minor Outlying Islands", "vu": "Vanuatu",
    "wf": "Wallis and Futuna", "ws": "Samoa",
    # South America
    "ar": "Argentina", "bo": "Bolivia", "br": "Brazil", "cl": "Chile",
    "co": "Colombia", "ec": "Ecuador", "fk": "Falkland Islands",
    "gf": "French Guiana", "gy": "Guyana", "pe": "Peru", "py": "Paraguay",
    "sr": "Suriname", "uy": "Uruguay", "ve": "Venezuela",
}


def name_for(code: str | None) -> str | None:
    """The English name of an ISO 3166-1 alpha-2 code, or None if it isn't one."""
    if not code:
        return None
    return COUNTRY_NAMES_EN.get(code.strip().lower())
