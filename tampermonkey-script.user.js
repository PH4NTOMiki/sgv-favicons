// ==UserScript==
// @name         Dynamic Favicon Updater
// @namespace    http://mikitvba.com
// @version      1.0
// @description  Updates favicon based on page title
// @match        https://cgm.mikitvba.com/*
// @grant        none
// ==/UserScript==

(function() {

    function updateFavicon() {
        var val = document.title.trim();
        console.log('new title:', val);

        var match = val.match(/\d{1,3}\.\d{1,2}/);
        var num = match ? match[0] : val;

        var imgurl = 'https://cdn.jsdelivr.net/gh/PH4NTOMiki/sgv-favicons/out/val_' + num.replace('.','') + '_' + ({'→':'east','↓':'south','↑':'north','↗':'northeast','↘':'southeast','⇈':'north','⇊':'south'})[val.slice(-1)] + '_512.png?ts=' + Math.random();
        console.log(imgurl);

        let links = document.querySelectorAll('link[rel*=icon]');
        if (links.length === 0) {
            let newLink = document.createElement('link');
            newLink.rel = 'icon';
            document.head.appendChild(newLink);
            links = [newLink];
        }
        links.forEach(e => e.href = imgurl);
    }
console.log('running temper');
    // Run once initially
    updateFavicon();

    // Set up observer for future changes
    new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            updateFavicon();
        });
    }).observe(document.querySelector('head > title'), { subtree: true, characterData: true, childList: true });
})();
