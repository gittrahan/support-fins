# Combined-support stress test

20 shapes × 7 orientations = 140 cases, buildFins('auto', tines) on each.
Regenerate: `python3 prototype/stress/gen.py && deno run --allow-read prototype/stress/run.js --verbose`

```
shape       pose    flag  fins props tines ovh seat   stilt  g     note
arch        flat    OK    0    0     0     0   face   0      0.0   no overhangs
arch        X30     OK    1    4     39    1   edge   0      3.4   
arch        X45     OK    1    0     39    0   edge   0      1.6   
arch        X60     OK    1    4     42    1   edge   0      3.3   
arch        Y45     OK    1    0     39    0   edge   0      1.4   
arch        X45Y30  OK    2    0     75    0   point  0      2.9   
arch        X60Z30  OK    1    4     42    1   edge   0      3.3   
bar         flat    OK    0    0     0     0   face   0      0.0   no overhangs
bar         X30     OK    1    1     48    1   edge   0      2.5   
bar         X45     OK    1    0     45    0   edge   0      2.4   
bar         X60     OK    1    1     33    1   edge   0      3.2   
bar         Y45     OK    1    0     45    0   edge   0      2.4   
bar         X45Y30  OK    2    0     38    0   point  0      1.4   
bar         X60Z30  OK    1    1     33    1   edge   0      3.2   
coin        flat    OK    0    0     0     0   face   0      0.0   no overhangs
coin        X30     OK    2    7     10    1   edge   2      11.9  
coin        X45     OK    2    0     10    0   edge   4      0.4   
coin        X60     OK    1    0     48    1   edge   0      3.2   
coin        Y45     OK    2    0     10    0   edge   4      0.5   
coin        X45Y30  OK    2    0     49    1   edge   3      3.4   
coin        X60Z30  OK    1    0     48    1   edge   0      3.2   
cone        flat    OK    0    0     0     0   face   0      0.0   no overhangs
cone        X30     OK    1    4     24    1   edge   0      3.2   
cone        X45     OK    2    0     42    0   edge   1      0.5   
cone        X60     OK    2    0     62    0   edge   0      2.3   
cone        Y45     OK    2    0     42    0   edge   1      0.5   
cone        X45Y30  OK    2    0     56    0   edge   1      2.3   
cone        X60Z30  OK    2    0     62    0   edge   0      2.3   
cube        flat    OK    0    0     0     0   face   0      0.0   no overhangs
cube        X30     OK    1    3     42    1   edge   0      3.6   
cube        X45     OK    1    0     39    0   edge   0      1.9   
cube        X60     OK    1    3     42    1   edge   0      3.6   
cube        Y45     OK    1    0     39    0   edge   0      1.9   
cube        X45Y30  OK    2    0     78    0   point  0      3.8   
cube        X60Z30  OK    1    3     42    1   edge   0      3.6   
cylinder    flat    OK    0    0     0     0   face   0      0.0   no overhangs
cylinder    X30     OK    2    3     48    1   edge   0      2.2   
cylinder    X45     OK    2    0     36    0   edge   0      0.8   
cylinder    X60     OK    2    4     53    1   edge   3      4.1   
cylinder    Y45     OK    2    0     36    0   edge   0      0.8   
cylinder    X45Y30  OK    2    3     43    1   edge   1      3.7   
cylinder    X60Z30  OK    2    4     53    1   edge   3      4.2   
hexprism    flat    OK    0    0     0     0   face   0      0.0   no overhangs
hexprism    X30     OK    2    3     71    1   edge   0      3.5   
hexprism    X45     OK    2    0     66    0   edge   0      2.5   
hexprism    X60     OK    2    2     69    1   edge   0      4.3   
hexprism    Y45     OK    2    0     48    0   point  0      1.8   
hexprism    X45Y30  OK    2    3     69    1   point  5      4.3   
hexprism    X60Z30  OK    2    2     69    1   edge   0      4.0   
lbracket    flat    OK    0    0     0     0   face   0      0.0   no overhangs
lbracket    X30     OK    1    4     39    1   edge   0      2.7   
lbracket    X45     OK    1    0     39    0   edge   0      1.6   
lbracket    X60     OK    1    4     30    1   edge   0      2.7   
lbracket    Y45     OK    1    0     26    0   edge   0      0.9   
lbracket    X45Y30  OK    2    0     42    0   point  0      2.6   
lbracket    X60Z30  OK    1    4     30    1   edge   0      2.7   
needle      flat    OK    0    0     0     0   face   0      0.0   no overhangs
needle      X30     OK    0    4     0     1   edge   0      3.0   
needle      X45     OK    2    0     12    0   edge   9      0.6   
needle      X60     OK    2    8     20    1   edge   8      7.8   
needle      Y45     OK    2    0     12    0   edge   9      0.6   
needle      X45Y30  OK    2    1     50    1   edge   0      4.4   
needle      X60Z30  OK    2    8     20    1   edge   8      7.8   
plate       flat    OK    0    0     0     0   face   0      0.0   no overhangs
plate       X30     OK    1    7     12    1   edge   0      9.2   
plate       X45     OK    1    0     6     0   edge   0      0.8   
plate       X60     OK    1    0     45    1   edge   0      2.9   
plate       Y45     OK    1    0     6     0   edge   0      0.7   
plate       X45Y30  OK    2    0     51    0   point  0      3.7   
plate       X60Z30  OK    1    0     45    1   edge   0      2.9   
plus        flat    OK    0    0     0     0   face   0      0.0   no overhangs
plus        X30     OK    1    4     36    1   edge   0      2.9   
plus        X45     OK    1    0     36    0   edge   0      0.8   
plus        X60     OK    1    3     42    3   edge   0      2.9   
plus        Y45     OK    1    0     36    0   edge   0      0.8   
plus        X45Y30  OK    2    0     49    0   point  1      1.9   
plus        X60Z30  OK    1    3     42    3   edge   0      2.9   
pyramid     flat    OK    0    0     0     0   face   0      0.0   no overhangs
pyramid     X30     OK    0    5     0     1   point  0      3.0   
pyramid     X45     OK    2    0     78    0   point  0      2.7   
pyramid     X60     OK    2    0     81    0   point  0      3.5   
pyramid     Y45     OK    2    0     78    0   point  0      2.7   
pyramid     X45Y30  OK    2    0     81    0   point  0      3.1   
pyramid     X60Z30  OK    2    0     81    0   point  0      3.5   
ramp        flat    OK    0    0     0     0   face   0      0.0   no overhangs
ramp        X30     OK    1    6     36    1   edge   0      3.3   
ramp        X45     OK    1    0     36    0   edge   0      1.5   
ramp        X60     OK    1    7     39    1   edge   0      3.2   
ramp        Y45     OK    2    0     60    0   edge   0      1.6   
ramp        X45Y30  OK    2    0     72    0   point  0      4.4   
ramp        X60Z30  OK    1    7     39    1   edge   0      3.3   
sphere      flat    OK    2    2     36    1   edge   9      1.3   
sphere      X30     OK    2    2     20    1   edge   5      0.8   
sphere      X45     OK    2    2     18    1   edge   6      0.7   
sphere      X60     OK    2    2     28    1   edge   8      0.9   
sphere      Y45     OK    2    2     18    1   edge   6      0.7   
sphere      X45Y30  OK    2    1     26    1   edge   7      0.8   
sphere      X60Z30  OK    2    2     28    1   edge   8      0.9   
staircase   flat    OK    0    0     0     0   face   0      0.0   no overhangs
staircase   X30     OK    1    3     39    1   edge   0      2.7   
staircase   X45     OK    1    0     36    0   edge   0      1.6   
staircase   X60     OK    1    5     42    1   edge   0      2.9   
staircase   Y45     OK    1    0     24    0   edge   0      0.7   
staircase   X45Y30  OK    2    0     69    0   point  0      3.9   
staircase   X60Z30  OK    1    5     42    1   edge   0      2.9   
torus       flat    FAIL  0    0     0     2   face   0      0.0   2 overhang region(s) but 0 support
torus       X30     OK    2    2     14    1   edge   3      0.7   
torus       X45     OK    2    2     14    2   edge   6      3.2   
torus       X60     OK    2    2     26    2   edge   6      3.1   
torus       Y45     OK    2    2     14    2   edge   6      3.2   
torus       X45Y30  OK    2    2     17    2   edge   5      3.4   
torus       X60Z30  OK    2    2     26    2   edge   6      3.1   
tshape      flat    OK    0    0     0     0   face   0      0.0   no overhangs
tshape      X30     OK    1    5     36    1   edge   0      2.7   
tshape      X45     OK    1    0     36    0   edge   0      1.4   
tshape      X60     OK    1    5     45    1   edge   0      2.5   
tshape      Y45     OK    1    0     36    0   edge   0      0.8   
tshape      X45Y30  OK    2    0     45    0   point  0      2.3   
tshape      X60Z30  OK    1    5     45    1   edge   0      2.7   
tube        flat    OK    0    0     0     0   face   0      0.0   no overhangs
tube        X30     OK    2    4     40    1   edge   1      2.4   
tube        X45     OK    2    0     32    0   edge   2      0.8   
tube        X60     OK    2    7     40    2   edge   3      4.4   
tube        Y45     OK    2    0     32    0   edge   2      0.9   
tube        X45Y30  OK    2    6     45    2   edge   1      4.9   
tube        X60Z30  OK    2    7     40    2   edge   3      4.4   
ushape      flat    OK    0    0     0     0   face   0      0.0   no overhangs
ushape      X30     OK    1    4     39    1   edge   0      3.0   
ushape      X45     OK    1    0     39    0   edge   0      1.6   
ushape      X60     OK    1    4     28    1   edge   0      2.6   
ushape      Y45     OK    1    0     39    0   edge   0      1.6   
ushape      X45Y30  OK    2    0     65    0   point  0      3.2   
ushape      X60Z30  OK    1    4     28    1   edge   0      2.6   
wedge       flat    OK    0    0     0     0   face   0      0.0   no overhangs
wedge       X30     OK    1    3     39    1   edge   0      2.5   
wedge       X45     OK    1    0     39    0   edge   0      1.6   
wedge       X60     OK    1    5     36    1   edge   0      3.0   
wedge       Y45     OK    1    0     36    0   point  0      1.5   
wedge       X45Y30  OK    2    0     72    0   point  0      3.7   
wedge       X60Z30  OK    1    5     36    1   edge   0      2.8   

140 cases: 139 OK, 0 WARN, 1 FAIL  |  119 cases placed >=1 tined combined fin
```

## Verified
- All added geometry closed (manifold edge parity).
- Visual spot-check (cube/cone/sphere/plate/lbracket/needle): fins follow the overhang face, bases on the plate, no fusion, no spindly stilts.
- 119/140 placed >=1 tined combined fin; round/needle parts correctly fall back to props + pad.

## Known limitation
- **torus flat**: the inner-ring underside is a bowl overhang with no face to fin and no room to prop -> 0 support. Tilting the torus resolves it (torus@X30+ places fins+props).
