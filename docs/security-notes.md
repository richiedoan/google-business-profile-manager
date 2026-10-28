# Rendering security and the local XSS lab

Normal account names, location titles, addresses, phone numbers and website text
render as React text children or form input values. Route identifiers are encoded
inside fixed application paths. No HTML rendering is required for these fields.
API/provider errors use application-owned messages selected by error code; the
request ID renders as escaped text. Raw provider details are not shown.

The rendering audit found no `dangerouslySetInnerHTML`, HTML assignment,
`insertAdjacentHTML`, `document.write`, dynamic JavaScript evaluation, or `srcDoc`
sinks in normal application code. The only intentional HTML sink is the isolated
iframe in `apps/web/components/xss-lab.tsx`. The automated audit assertion checks
application, component and library source files for these sink patterns; it is a
regression check, not a complete static security analysis.

## Source → sink → impact → mitigation

| Case                       | Source                                                   | Sink                                                    | Impact                                                                         | Mitigation                                                                                       |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| INSECURE DEMO              | Synthetic description entered in the local lab textarea  | Input concatenated into iframe `srcDoc`, parsed as HTML | The sample image error handler executes and changes the iframe status text     | Keep this sink confined to the gated lab and sandbox; never use it in the application            |
| Secure equivalent          | The same synthetic description                           | Normal React text child in `<pre>`                      | Markup appears literally; no event handler executes                            | React escaping; no HTML interpretation                                                           |
| Normal location/account UI | Provider-controlled names, addresses and contact strings | React text children and form values                     | An unsafe HTML sink could allow stored XSS affecting users who view the record | Keep normal React escaping; explicitly encode route IDs; validate editable fields on the service |
| Normal error UI            | API/provider error payloads                              | Fixed application messages plus escaped request ID      | Interpreting error HTML could permit reflected XSS                             | Map error codes to owned text; never interpret error strings as HTML                             |

Input validation supports domain correctness, but does not replace safe output
handling. If rich HTML becomes a real product requirement, adopt a reviewed,
maintained sanitizer with an explicit allowlist of elements, attributes and URL
schemes before adding an HTML sink. This application currently needs plain text,
so it does not add a sanitizer or HTML rendering to normal flows.

## Run the controlled comparison

Set `LOCAL_LAB=true` in `apps/web/.env.local`, restart the development web server,
and open `http://localhost:3000/labs/xss`. No API login or database is needed for
this route. Click **Run comparison**. The **INSECURE DEMO** frame executes a
synthetic image error handler that changes only its status message. The secure
panel displays the identical input literally. **Reset demo** restores the sample.

The server checks the flag and loopback Host on each request. The route returns
404 by default, for nonlocal hosts, and whenever `NODE_ENV=production`, even if
the flag is true. Only development/test environments may enable it. The flag is
server-only and must not be renamed to a `NEXT_PUBLIC_*` variable. The development
server binds to localhost; do not expose it through a tunnel or proxy. Disable
`LOCAL_LAB` and restart when finished.

The intentionally unsafe sink is bounded by an iframe with only `allow-scripts`.
It does not grant `allow-same-origin`, top navigation, popups or forms. Its opaque
origin prevents access to parent application storage and DOM. A restrictive
frame Content Security Policy blocks outbound network requests and allows inline
script solely for the demonstration. The sample contains no credentials, tokens,
real business records or other sensitive data. Do not paste sensitive data into
the lab. The iframe containment is specific to this teaching example; it does
not make an ordinary same-origin application HTML sink safe.

## HttpOnly limits theft; it does not prevent acting as the user

An HttpOnly session cookie is unavailable through `document.cookie`. This reduces
exposure to direct cookie/session-token theft by injected JavaScript. It does
not stop the browser from attaching that cookie to authenticated requests.

A script injected into the application origin can still make API requests using
the victim's session, read responses accessible to that origin, change the page,
and perform actions the victim is authorized to perform. In this application's
credentialed BFF setup, injected frontend code could fetch `/api/csrf`, obtain the
session-bound CSRF proof, and submit a mutation with the cookie automatically
attached. Origin/CSRF checks defend against cross-site request forgery; they do
not neutralize script already running in the trusted frontend origin.

Server-side permission and resource checks still limit those actions to the
victim's authorized scope. HttpOnly, CSRF, authorization and escaping address
different parts of the threat. Preventing XSS with safe rendering remains
necessary even when cookies are HttpOnly. The lab's opaque-origin sandbox does
not have these same-origin privileges.

## Verification

`npm run test -w @gbp/web` includes rendering tests that feed synthetic HTML/event
handlers into actual account and location components, verify escaped markup and
encoded route identifiers, and verify that error messages are suppressed while
request IDs are escaped. Tests also check the environment/host gate and assert
that unsafe sink patterns remain confined to the isolated lab component.
