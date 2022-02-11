// Standard gaussian implementation; https://filosophy.org/code/normal-distributed-random-values-in-javascript-using-the-ziggurat-algorithm/
function Ziggurat(){
  var jsr = 123456789;

  var wn = Array(128);
  var fn = Array(128);
  var kn = Array(128);

  function RNOR(){
    var hz = SHR3();
    var iz = hz & 127;
    return (Math.abs(hz) < kn[iz]) ? hz * wn[iz] : nfix(hz, iz);
  }
  this.nextGaussian = function(){
    return RNOR();
  }
  function nfix(hz, iz){
    var r = 3.442619855899;
    var r1 = 1.0 / r;
    var x;
    var y;
    while(true){
      x = hz * wn[iz];
      if( iz == 0 ){
        x = (-Math.log(UNI()) * r1); 
        y = -Math.log(UNI());
        while( y + y < x * x){
          x = (-Math.log(UNI()) * r1); 
          y = -Math.log(UNI());
        }
        return ( hz > 0 ) ? r+x : -r-x;
      }

      if( fn[iz] + UNI() * (fn[iz-1] - fn[iz]) < Math.exp(-0.5 * x * x) ){
          return x;
      }
      hz = SHR3();
      iz = hz & 127;

      if( Math.abs(hz) < kn[iz]){
        return (hz * wn[iz]);
      }
    }
  }
  function SHR3(){
    var jz = jsr;
    var jzr = jsr;
    jzr ^= (jzr << 13);
    jzr ^= (jzr >>> 17);
    jzr ^= (jzr << 5);
    jsr = jzr;
    return (jz+jzr) | 0;
  }
  function UNI(){
    return 0.5 * (1 + SHR3() / -Math.pow(2,31));
  }
  function zigset(){
    // seed generator based on current time
    jsr ^= new Date().getTime();

    var m1 = 2147483648.0;
    var dn = 3.442619855899;
    var tn = dn;
    var vn = 9.91256303526217e-3;
    
    var q = vn / Math.exp(-0.5 * dn * dn);
    kn[0] = Math.floor((dn/q)*m1);
    kn[1] = 0;

    wn[0] = q / m1;
    wn[127] = dn / m1;

    fn[0] = 1.0;
    fn[127] = Math.exp(-0.5 * dn * dn);

    for(var i = 126; i >= 1; i--){
      dn = Math.sqrt(-2.0 * Math.log( vn / dn + Math.exp( -0.5 * dn * dn)));
      kn[i+1] = Math.floor((dn/tn)*m1);
      tn = dn;
      fn[i] = Math.exp(-0.5 * dn * dn);
      wn[i] = dn / m1;
    }
  }
  zigset();
}

function simulateGame() {
  let distance = 100 // distance of the goal
  let mean = 10
  let stdev = 1

  let turtleWinDistances // individual distances moved by winning turtle
  let turtleLoseDistances // individual distances moved by losing turtle
  let secPerMove = [] // stores info on the time for each move animation

  // starting game simulation
  const gaussian = new Ziggurat()
  let turtleADistance = 0 ; let turtleBDistance = 0
  let turtleADistances = [] ; let turtleBDistances = []

  for (let i=0; i<100; i++) {
    turtleAMove = gaussian.nextGaussian()*stdev+mean
    turtleBMove = gaussian.nextGaussian()*stdev+mean
    turtleADistance += turtleAMove
    turtleBDistance += turtleBMove

    if (turtleADistance>=distance || turtleBDistance>=distance) { // a turtle has won
      let turtleADistanceLeft = distance-(turtleADistance-turtleAMove)
      let turtleASecToFinish = turtleADistanceLeft/turtleAMove

      let turtleBDistanceLeft = distance-(turtleBDistance-turtleBMove)
      let turtleBSecToFinish = turtleBDistanceLeft/turtleBMove

      if (turtleADistance > turtleBDistance) { // turtle A wins
        let turtleBFinalDistance = turtleBMove*turtleASecToFinish+(turtleBDistance-turtleBMove)
        turtleADistances.push(distance)
        turtleBDistances.push(turtleBFinalDistance)

        turtleWinDistances = turtleADistances
        turtleLoseDistances = turtleBDistances
        secPerMove.push(turtleASecToFinish)
      } else { // turtle B wins
        let turtleAFinalDistance = turtleAMove*turtleBSecToFinish+(turtleADistance-turtleAMove)
        turtleBDistances.push(distance)
        turtleADistances.push(turtleAFinalDistance)

        turtleWinDistances = turtleBDistances
        turtleLoseDistances = turtleADistances
        secPerMove.push(turtleBSecToFinish)
      }
      break

    } else {
      turtleADistances.push(turtleADistance)
      turtleBDistances.push(turtleBDistance)
      secPerMove.push(1) // each move is 1 second long
    }

  }
  return [turtleWinDistances,turtleLoseDistances,secPerMove]
}
